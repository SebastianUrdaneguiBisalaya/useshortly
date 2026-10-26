package user

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeStore mimics the Redis store: hashed code, attempt counter, single use, cooldown.
type fakeStore struct {
	hash     string
	attempts int
	cooldown bool
	puts     int
	putErr   error
}

func (f *fakeStore) Put(_ context.Context, _, codeHash string, _, _ time.Duration) error {
	if f.putErr != nil {
		return f.putErr
	}
	if f.cooldown {
		return ErrResetTooSoon
	}
	f.hash, f.attempts, f.cooldown = codeHash, 0, true
	f.puts++
	return nil
}

func (f *fakeStore) Check(_ context.Context, _, codeHash string, max int) error {
	if f.hash == "" {
		return ErrInvalidResetCode
	}
	f.attempts++
	if f.hash == codeHash {
		f.hash = ""
		return nil
	}
	if f.attempts >= max {
		f.hash = ""
		return ErrTooManyAttempts
	}
	return ErrInvalidResetCode
}

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
	svc     *PasswordResetService
	repo    *fakeRepo
	store   *fakeStore
	mailer  *fakeMailer
	revoker *fakeRevoker
	user    User
}

func newResetEnv(t *testing.T) resetEnv {
	t.Helper()
	users, repo, _ := newServiceWithMailer()
	u, err := users.Register(context.Background(), valid)
	require.NoError(t, err)
	e := resetEnv{repo: repo, store: &fakeStore{}, mailer: &fakeMailer{}, revoker: &fakeRevoker{}, user: u}
	e.svc = NewPasswordResetService(repo, fakeHasher{}, e.store, e.mailer, e.revoker, "test-key-test-key-test-key-test-key")
	e.svc.newCode = func() (string, error) { return "123456", nil }
	return e
}

func (e resetEnv) forgot(t *testing.T) {
	t.Helper()
	require.NoError(t, e.svc.ForgotPassword(context.Background(), "ana@example.com"))
}

func TestForgotPasswordSendsCodeByEmail(t *testing.T) {
	e := newResetEnv(t)
	e.forgot(t)
	require.Len(t, e.mailer.sent, 1)
	m := e.mailer.sent[0]
	assert.Equal(t, "PASSWORD_RESET", m.code)
	assert.Equal(t, "ana@example.com", m.to)
	assert.Equal(t, "123456", m.data["Code"])
	assert.Equal(t, "10", m.data["ExpiresInMinutes"])
	assert.Equal(t, "3", m.data["MaxAttempts"])
	assert.NotContains(t, e.store.hash, "123456", "only an HMAC of the code is stored")
	assert.Len(t, e.store.hash, 64)
}

func TestForgotPasswordNeverRevealsWhetherTheEmailExists(t *testing.T) {
	e := newResetEnv(t)
	ctx := context.Background()
	assert.NoError(t, e.svc.ForgotPassword(ctx, "nobody@example.com"))
	assert.NoError(t, e.svc.ForgotPassword(ctx, "not-an-email"))
	assert.Empty(t, e.mailer.sent)
	assert.Zero(t, e.store.puts)

	e.forgot(t)
	assert.NoError(t, e.svc.ForgotPassword(ctx, "ana@example.com"), "rate limited requests look the same")
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
	assert.NoError(t, e.svc.ForgotPassword(context.Background(), "ana@example.com"))

	e = newResetEnv(t)
	e.store.putErr = errors.New("redis down")
	assert.ErrorIs(t, e.svc.ForgotPassword(context.Background(), "ana@example.com"), e.store.putErr)
}

func TestResetPassword(t *testing.T) {
	e := newResetEnv(t)
	ctx := context.Background()
	e.forgot(t)

	require.NoError(t, e.svc.ResetPassword(ctx, " ANA@example.com ", "123456", "brand-new-pass"))
	assert.Equal(t, "hash:brand-new-pass", e.repo.accounts[e.user.ID].PasswordHash)
	assert.Equal(t, []int64{e.user.ID}, e.revoker.revoked, "all sessions revoked")

	err := e.svc.ResetPassword(ctx, "ana@example.com", "123456", "another-pass-1")
	assert.ErrorIs(t, err, ErrInvalidResetCode, "a code works once")
}

func TestResetPasswordWrongCodeThenTooManyAttempts(t *testing.T) {
	e := newResetEnv(t)
	ctx := context.Background()
	e.forgot(t)

	assert.ErrorIs(t, e.svc.ResetPassword(ctx, "ana@example.com", "000000", "brand-new-pass"), ErrInvalidResetCode)
	assert.ErrorIs(t, e.svc.ResetPassword(ctx, "ana@example.com", "000001", "brand-new-pass"), ErrInvalidResetCode)
	assert.ErrorIs(t, e.svc.ResetPassword(ctx, "ana@example.com", "000002", "brand-new-pass"), ErrTooManyAttempts)
	// The right code no longer works after the third failure.
	assert.ErrorIs(t, e.svc.ResetPassword(ctx, "ana@example.com", "123456", "brand-new-pass"), ErrInvalidResetCode)
	assert.Equal(t, "hash:s3cretpass", e.repo.accounts[e.user.ID].PasswordHash, "password untouched")
	assert.Empty(t, e.revoker.revoked)
}

func TestResetPasswordWeakPasswordDoesNotBurnAnAttempt(t *testing.T) {
	e := newResetEnv(t)
	e.forgot(t)
	assert.ErrorIs(t, e.svc.ResetPassword(context.Background(), "ana@example.com", "123456", "short"), ErrWeakPassword)
	assert.Zero(t, e.store.attempts)
	assert.NoError(t, e.svc.ResetPassword(context.Background(), "ana@example.com", "123456", "long-enough-pass"))
}

func TestResetPasswordCodeIsBoundToTheEmail(t *testing.T) {
	e := newResetEnv(t)
	e.forgot(t)
	// Same code, other email: the HMAC differs.
	err := e.svc.ResetPassword(context.Background(), "other@example.com", "123456", "brand-new-pass")
	assert.ErrorIs(t, err, ErrInvalidResetCode)
	assert.Empty(t, e.revoker.revoked)
}

func TestResetPasswordRevokesBeforeChangingThePassword(t *testing.T) {
	e := newResetEnv(t)
	e.forgot(t)
	e.revoker.err = errors.New("db down")
	err := e.svc.ResetPassword(context.Background(), "ana@example.com", "123456", "brand-new-pass")
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
