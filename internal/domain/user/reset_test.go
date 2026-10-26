package user

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRevoker struct {
	revoked []int64
	err     error
}

func (r *fakeRevoker) RevokeForUser(_ context.Context, userID int64) error {
	if r.err != nil {
		return r.err
	}
	r.revoked = append(r.revoked, userID)
	return nil
}

type resetEnv struct {
	*env
	reset   *PasswordResetService
	revoker *fakeRevoker
	user    User
}

func newResetEnv(t *testing.T) resetEnv {
	t.Helper()
	e := newEnv()
	u := e.signUp(t, valid)
	r := &fakeRevoker{}
	return resetEnv{
		env:     e,
		reset:   NewPasswordResetService(e.repo, fakeHasher{}, e.otp, e.mailer, r),
		revoker: r,
		user:    u,
	}
}

func (e resetEnv) forgot(t *testing.T) {
	t.Helper()
	require.NoError(t, e.reset.ForgotPassword(ctx, "ana@example.com"))
}

func TestForgotPasswordSendsCodeByEmail(t *testing.T) {
	e := newResetEnv(t)
	e.forgot(t)
	require.Len(t, e.mailer.sent, 1)
	m := e.mailer.sent[0]
	assert.Equal(t, "PASSWORD_RESET", m.code)
	assert.Equal(t, "ana@example.com", m.to)
	assert.Equal(t, testCode, m.data["Code"])
	assert.Equal(t, "10", m.data["ExpiresInMinutes"])
	assert.Equal(t, "3", m.data["MaxAttempts"])
	entry := e.store.entries[storeKey(PurposeReset, "ana@example.com")]
	require.NotNil(t, entry)
	assert.NotContains(t, entry.hash, testCode, "only an HMAC of the code is stored")
	assert.Len(t, entry.hash, 64)
}

func TestForgotPasswordNeverRevealsWhetherTheEmailExists(t *testing.T) {
	e := newResetEnv(t)
	assert.NoError(t, e.reset.ForgotPassword(ctx, "nobody@example.com"))
	assert.NoError(t, e.reset.ForgotPassword(ctx, "not-an-email"))
	assert.Empty(t, e.mailer.sent)
	assert.Empty(t, e.store.entries)

	e.forgot(t)
	assert.NoError(t, e.reset.ForgotPassword(ctx, "ana@example.com"), "rate limited requests look the same")
	assert.Len(t, e.mailer.sent, 1, "the second request sent nothing")
}

func TestForgotPasswordSkipsUsersWithoutPassword(t *testing.T) {
	e := newResetEnv(t)
	e.repo.accounts[e.user.ID] = Account{UserID: e.user.ID, Provider: ProviderGoogle}
	e.forgot(t)
	assert.Empty(t, e.mailer.sent)
}

func TestForgotPasswordSurvivesMailFailureButNotStoreFailure(t *testing.T) {
	e := newResetEnv(t)
	e.mailer.err = errors.New("provider down")
	assert.NoError(t, e.reset.ForgotPassword(ctx, "ana@example.com"))

	e = newResetEnv(t)
	e.store.putErr = errors.New("redis down")
	assert.ErrorIs(t, e.reset.ForgotPassword(ctx, "ana@example.com"), e.store.putErr)
}

func TestResetPassword(t *testing.T) {
	e := newResetEnv(t)
	e.forgot(t)

	require.NoError(t, e.reset.ResetPassword(ctx, " ANA@example.com ", testCode, "brand-new-pass"))
	assert.Equal(t, "hash:brand-new-pass", e.repo.accounts[e.user.ID].PasswordHash)
	assert.Equal(t, []int64{e.user.ID}, e.revoker.revoked, "all sessions revoked")

	err := e.reset.ResetPassword(ctx, "ana@example.com", testCode, "another-pass-1")
	assert.ErrorIs(t, err, ErrInvalidCode, "a code works once")
}

func TestResetPasswordWrongCodeThenTooManyAttempts(t *testing.T) {
	e := newResetEnv(t)
	e.forgot(t)

	assert.ErrorIs(t, e.reset.ResetPassword(ctx, "ana@example.com", "000000", "brand-new-pass"), ErrInvalidCode)
	assert.ErrorIs(t, e.reset.ResetPassword(ctx, "ana@example.com", "000001", "brand-new-pass"), ErrInvalidCode)
	assert.ErrorIs(t, e.reset.ResetPassword(ctx, "ana@example.com", "000002", "brand-new-pass"), ErrTooManyAttempts)
	// The right code no longer works after the third failure.
	assert.ErrorIs(t, e.reset.ResetPassword(ctx, "ana@example.com", testCode, "brand-new-pass"), ErrInvalidCode)
	assert.Equal(t, "hash:s3cretpass", e.repo.accounts[e.user.ID].PasswordHash, "password untouched")
	assert.Empty(t, e.revoker.revoked)
}

func TestResetPasswordWeakPasswordDoesNotBurnAnAttempt(t *testing.T) {
	e := newResetEnv(t)
	e.forgot(t)
	assert.ErrorIs(t, e.reset.ResetPassword(ctx, "ana@example.com", testCode, "short"), ErrWeakPassword)
	assert.Zero(t, e.store.entries[storeKey(PurposeReset, "ana@example.com")].attempts)
	assert.NoError(t, e.reset.ResetPassword(ctx, "ana@example.com", testCode, "long-enough-pass"))
}

func TestResetPasswordCodeIsBoundToTheEmail(t *testing.T) {
	e := newResetEnv(t)
	e.forgot(t)
	err := e.reset.ResetPassword(ctx, "other@example.com", testCode, "brand-new-pass")
	assert.ErrorIs(t, err, ErrInvalidCode)
	assert.Empty(t, e.revoker.revoked)
}

func TestASignupCodeCannotResetAPassword(t *testing.T) {
	e := newResetEnv(t)
	e.store.cooldown = map[string]bool{} // signUp already used the signup cooldown
	_, err := e.otp.issue(ctx, PurposeSignup, "ana@example.com", "{}")
	require.NoError(t, err)
	err = e.reset.ResetPassword(ctx, "ana@example.com", testCode, "brand-new-pass")
	assert.ErrorIs(t, err, ErrInvalidCode)
}

func TestResetPasswordRevokesBeforeChangingThePassword(t *testing.T) {
	e := newResetEnv(t)
	e.forgot(t)
	e.revoker.err = errors.New("db down")
	err := e.reset.ResetPassword(ctx, "ana@example.com", testCode, "brand-new-pass")
	assert.ErrorIs(t, err, e.revoker.err)
	assert.Equal(t, "hash:s3cretpass", e.repo.accounts[e.user.ID].PasswordHash, "password unchanged if sessions could not be revoked")
}

func TestRandomCode(t *testing.T) {
	seen := map[string]bool{}
	for range 200 {
		c, err := randomCode()
		require.NoError(t, err)
		require.Regexp(t, `^\d{6}$`, c)
		seen[c] = true
	}
	assert.Greater(t, len(seen), 150)
}
