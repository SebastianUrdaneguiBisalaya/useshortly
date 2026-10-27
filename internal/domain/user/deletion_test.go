package user

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type kicks struct{ n int }

func (k *kicks) Kick() { k.n++ }

type deletionEnv struct {
	*env
	svc   *DeletionService
	kicks *kicks
	user  User
}

func newDeletionEnv(t *testing.T) deletionEnv {
	t.Helper()
	e := newEnv()
	u := e.signUp(t, valid)
	k := &kicks{}
	return deletionEnv{env: e, svc: NewDeletionService(e.repo, e.otp, e.mailer, k), kicks: k, user: u}
}

func TestRequestCodeSendsTheDeletionTemplate(t *testing.T) {
	e := newDeletionEnv(t)
	e.mailer.sent = nil
	require.NoError(t, e.svc.RequestCode(ctx, e.user.ID))
	require.Len(t, e.mailer.sent, 1)
	assert.Equal(t, "ACCOUNT_DELETION", e.mailer.sent[0].code)
	assert.Equal(t, "ana@example.com", e.mailer.sent[0].to)
	assert.Equal(t, testCode, e.mailer.sent[0].data["Code"])

	assert.ErrorIs(t, e.svc.RequestCode(ctx, e.user.ID), ErrCodeTooSoon)
	assert.ErrorIs(t, e.svc.RequestCode(ctx, 999), ErrNotFound)
}

func TestRequestCodeSurvivesMailFailure(t *testing.T) {
	e := newDeletionEnv(t)
	e.mailer.err = errors.New("provider down")
	assert.NoError(t, e.svc.RequestCode(ctx, e.user.ID))
}

func TestDeleteNeedsTheRightCode(t *testing.T) {
	e := newDeletionEnv(t)
	assert.ErrorIs(t, e.svc.Delete(ctx, e.user.ID, testCode), ErrInvalidCode, "no code was requested")

	require.NoError(t, e.svc.RequestCode(ctx, e.user.ID))
	assert.ErrorIs(t, e.svc.Delete(ctx, e.user.ID, "000000"), ErrInvalidCode)
	assert.Contains(t, e.repo.users, e.user.ID)
	assert.Zero(t, e.kicks.n)

	require.NoError(t, e.svc.Delete(ctx, e.user.ID, testCode))
	assert.NotContains(t, e.repo.users, e.user.ID)
	assert.Equal(t, 1, e.kicks.n, "the purger is woken")
	assert.ErrorIs(t, e.svc.Delete(ctx, e.user.ID, testCode), ErrNotFound, "already gone")
}

func TestCodeForDeletingCannotResetAPasswordNorViceVersa(t *testing.T) {
	e := newDeletionEnv(t)
	reset := NewPasswordResetService(e.repo, fakeHasher{}, e.otp, e.mailer, &fakeRevoker{})
	require.NoError(t, reset.ForgotPassword(ctx, "ana@example.com"))
	assert.ErrorIs(t, e.svc.Delete(ctx, e.user.ID, testCode), ErrInvalidCode, "a reset code does not delete accounts")
	assert.Contains(t, e.repo.users, e.user.ID)
}

func TestFailedTransactionKeepsTheAccount(t *testing.T) {
	e := newDeletionEnv(t)
	e.repo.deleteErr = errors.New("database is locked")
	require.NoError(t, e.svc.RequestCode(ctx, e.user.ID))
	assert.ErrorIs(t, e.svc.Delete(ctx, e.user.ID, testCode), e.repo.deleteErr)
	assert.Contains(t, e.repo.users, e.user.ID)
	assert.Zero(t, e.kicks.n, "nothing to purge")
}
