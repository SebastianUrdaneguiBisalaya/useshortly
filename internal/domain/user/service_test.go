package user

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepo struct {
	users    map[int64]User
	accounts map[int64]Account
	nextID   int64
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{users: map[int64]User{}, accounts: map[int64]Account{}}
}

func (r *fakeRepo) Create(_ context.Context, u User, a Account) (User, error) {
	for _, e := range r.users {
		if strings.EqualFold(e.Email, u.Email) {
			return User{}, ErrEmailTaken
		}
	}
	r.nextID++
	u.ID, a.UserID, a.ID = r.nextID, r.nextID, r.nextID
	r.users[u.ID], r.accounts[u.ID] = u, a
	return u, nil
}

func (r *fakeRepo) FindAccountByProvider(_ context.Context, p Provider, accountID string) (Account, error) {
	for _, a := range r.accounts {
		if a.Provider == p && a.AccountID == accountID {
			return a, nil
		}
	}
	return Account{}, ErrNotFound
}

func (r *fakeRepo) UpdatePassword(_ context.Context, userID int64, hash string, at time.Time) error {
	a, ok := r.accounts[userID]
	if !ok || a.Provider != ProviderDefault {
		return ErrNotFound
	}
	a.PasswordHash, a.UpdatedAt = hash, &at
	r.accounts[userID] = a
	return nil
}

func (r *fakeRepo) UpdateAccountScope(_ context.Context, accountID int64, scope string, at time.Time) error {
	for uid, a := range r.accounts {
		if a.ID == accountID {
			a.Scope, a.UpdatedAt = scope, &at
			r.accounts[uid] = a
			return nil
		}
	}
	return ErrNotFound
}

func (r *fakeRepo) FindByEmail(_ context.Context, email string) (User, error) {
	for _, u := range r.users {
		if u.Email == email {
			return u, nil
		}
	}
	return User{}, ErrNotFound
}

func (r *fakeRepo) FindByID(_ context.Context, id int64) (User, error) {
	if u, ok := r.users[id]; ok {
		return u, nil
	}
	return User{}, ErrNotFound
}

func (r *fakeRepo) FindAccount(_ context.Context, userID int64, p Provider) (Account, error) {
	if a, ok := r.accounts[userID]; ok && a.Provider == p {
		return a, nil
	}
	return Account{}, ErrNotFound
}

type fakeHasher struct{}

func (fakeHasher) Hash(p string) (string, error) { return "hash:" + p, nil }
func (fakeHasher) Verify(h, p string) (bool, error) {
	return h == "hash:"+p, nil
}

type fakeTokens struct{}

func (fakeTokens) Generate(_ context.Context, id string) (auth.Token, error) {
	return auth.Token{Value: "tok:" + id, ExpiresAt: time.Unix(1000, 0)}, nil
}
func (fakeTokens) Validate(_ context.Context, t string) (string, error) {
	if id, ok := strings.CutPrefix(t, "tok:"); ok {
		return id, nil
	}
	return "", auth.ErrInvalidCredentials
}

type sentMail struct {
	code, to string
	cc, bcc  []string
	data     map[string]string
}

type fakeMailer struct {
	sent []sentMail
	err  error
}

func (m *fakeMailer) Send(_ context.Context, req mailing.Request) error {
	m.sent = append(m.sent, sentMail{req.Code, req.To, req.CC, req.BCC, req.Data})
	return m.err
}

// fakeStore mimics the Redis store: per purpose and email a hashed code with its payload,
// an attempt counter, single use and a cooldown.
type fakeStore struct {
	entries  map[string]*storedCode
	cooldown map[string]bool
	putErr   error
}

type storedCode struct {
	hash, payload string
	attempts      int
}

func newFakeStore() *fakeStore {
	return &fakeStore{entries: map[string]*storedCode{}, cooldown: map[string]bool{}}
}

func storeKey(p Purpose, email string) string { return string(p) + ":" + email }

func (f *fakeStore) Put(_ context.Context, p Purpose, email, codeHash, payload string, _, _ time.Duration) error {
	if f.putErr != nil {
		return f.putErr
	}
	k := storeKey(p, email)
	if f.cooldown[k] {
		return ErrCodeTooSoon
	}
	f.cooldown[k] = true
	f.entries[k] = &storedCode{hash: codeHash, payload: payload}
	return nil
}

func (f *fakeStore) Check(_ context.Context, p Purpose, email, codeHash string, max int) (string, error) {
	k := storeKey(p, email)
	e, ok := f.entries[k]
	if !ok {
		return "", ErrInvalidCode
	}
	e.attempts++
	if e.hash == codeHash {
		delete(f.entries, k)
		return e.payload, nil
	}
	if e.attempts >= max {
		delete(f.entries, k)
		return "", ErrTooManyAttempts
	}
	return "", ErrInvalidCode
}

// fakeRefresh issues "rft_<n>" tokens; each one rotates once, like the real service.
type fakeRefresh struct {
	owner   map[string]int64
	revoked map[string]bool
	next    int
}

func newFakeRefresh() *fakeRefresh {
	return &fakeRefresh{owner: map[string]int64{}, revoked: map[string]bool{}}
}

func (f *fakeRefresh) Issue(_ context.Context, userID int64) (auth.RefreshGrant, error) {
	f.next++
	tok := "rft_" + strconv.Itoa(f.next)
	f.owner[tok] = userID
	return auth.RefreshGrant{Token: tok, ExpiresAt: time.Unix(5000, 0)}, nil
}

func (f *fakeRefresh) Rotate(ctx context.Context, secret string) (int64, auth.RefreshGrant, error) {
	id, ok := f.owner[secret]
	if !ok || f.revoked[secret] {
		return 0, auth.RefreshGrant{}, auth.ErrInvalidCredentials
	}
	f.revoked[secret] = true
	g, _ := f.Issue(ctx, id)
	return id, g, nil
}

func (f *fakeRefresh) Revoke(_ context.Context, secret string) error {
	f.revoked[secret] = true
	return nil
}

// env wires a Service with fakes. Codes are always 123456.
type env struct {
	svc     *Service
	repo    *fakeRepo
	mailer  *fakeMailer
	store   *fakeStore
	otp     *OTP
	refresh *fakeRefresh
}

const testCode = "123456"

func newEnvWithRepo(repo *fakeRepo) *env {
	e := &env{repo: repo, mailer: &fakeMailer{}, store: newFakeStore(), refresh: newFakeRefresh()}
	e.otp = NewOTP(e.store, "test-key-test-key-test-key-test-key")
	e.otp.newCode = func() (string, error) { return testCode, nil }
	e.svc = NewService(repo, fakeHasher{}, fakeTokens{}, e.refresh, e.mailer, e.otp)
	return e
}

func newEnv() *env { return newEnvWithRepo(newFakeRepo()) }

// signUp completes a registration and forgets the emails it sent.
func (e *env) signUp(t *testing.T, in RegisterInput) User {
	t.Helper()
	require.NoError(t, e.svc.Register(context.Background(), in))
	s, err := e.svc.VerifyRegistration(context.Background(), in.Email, testCode)
	require.NoError(t, err)
	e.mailer.sent = nil
	return s.User
}

var valid = RegisterInput{Email: "  Ana@Example.com ", Password: "s3cretpass", FirstName: "Ana", LastName: "Lopez"}

var ctx = context.Background()

func TestRegisterOnlyStartsTheSignup(t *testing.T) {
	e := newEnv()
	require.NoError(t, e.svc.Register(ctx, valid))
	assert.Empty(t, e.repo.users, "no user before the email is confirmed")

	require.Len(t, e.mailer.sent, 1)
	m := e.mailer.sent[0]
	assert.Equal(t, "VERIFY_EMAIL", m.code)
	assert.Equal(t, "ana@example.com", m.to)
	assert.Equal(t, testCode, m.data["Code"])
	assert.Equal(t, "Ana", m.data["FirstName"])
	assert.Equal(t, "10", m.data["ExpiresInMinutes"])
	assert.Equal(t, "3", m.data["MaxAttempts"])
}

func TestPendingSignupNeverStoresThePlainPassword(t *testing.T) {
	e := newEnv()
	require.NoError(t, e.svc.Register(ctx, valid))
	for _, entry := range e.store.entries {
		var fields map[string]string
		require.NoError(t, json.Unmarshal([]byte(entry.payload), &fields))
		assert.ElementsMatch(t, []string{"first_name", "last_name", "password_hash"}, keysOf(fields), "no plain password field")
		assert.Equal(t, "hash:s3cretpass", fields["password_hash"])
		assert.NotContains(t, entry.hash, testCode, "only an HMAC of the code is stored")
	}
}

func keysOf(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func TestVerifyRegistrationCreatesAVerifiedUserAndSignsThemIn(t *testing.T) {
	e := newEnv()
	require.NoError(t, e.svc.Register(ctx, valid))
	e.mailer.sent = nil

	s, err := e.svc.VerifyRegistration(ctx, " ANA@example.com ", testCode)
	require.NoError(t, err)
	assert.Equal(t, "ana@example.com", s.User.Email)
	assert.True(t, s.User.EmailVerified)
	assert.NotZero(t, s.User.ID)
	assert.Equal(t, "tok:1", s.Token.Value)
	assert.Equal(t, "rft_1", s.Refresh.Token, "signup opens a full session")

	acc := e.repo.accounts[s.User.ID]
	assert.Equal(t, ProviderDefault, acc.Provider)
	assert.Equal(t, "hash:s3cretpass", acc.PasswordHash)

	require.Len(t, e.mailer.sent, 1)
	assert.Equal(t, "WELCOME", e.mailer.sent[0].code)
}

func TestVerifyRegistrationWrongCodeThenTooManyAttempts(t *testing.T) {
	e := newEnv()
	require.NoError(t, e.svc.Register(ctx, valid))
	_, err := e.svc.VerifyRegistration(ctx, valid.Email, "000000")
	assert.ErrorIs(t, err, ErrInvalidCode)
	_, err = e.svc.VerifyRegistration(ctx, valid.Email, "000001")
	assert.ErrorIs(t, err, ErrInvalidCode)
	_, err = e.svc.VerifyRegistration(ctx, valid.Email, "000002")
	assert.ErrorIs(t, err, ErrTooManyAttempts)
	_, err = e.svc.VerifyRegistration(ctx, valid.Email, testCode)
	assert.ErrorIs(t, err, ErrInvalidCode, "the right code is dead after the third failure")
	assert.Empty(t, e.repo.users)
}

func TestVerifyRegistrationCodeWorksOnce(t *testing.T) {
	e := newEnv()
	e.signUp(t, valid)
	_, err := e.svc.VerifyRegistration(ctx, valid.Email, testCode)
	assert.ErrorIs(t, err, ErrInvalidCode)
	assert.Len(t, e.repo.users, 1)
}

func TestVerifyRegistrationWithoutRegisterOrForAnotherEmail(t *testing.T) {
	e := newEnv()
	_, err := e.svc.VerifyRegistration(ctx, "ana@example.com", testCode)
	assert.ErrorIs(t, err, ErrInvalidCode)
	_, err = e.svc.VerifyRegistration(ctx, "nope", testCode)
	assert.ErrorIs(t, err, ErrInvalidCode)

	require.NoError(t, e.svc.Register(ctx, valid))
	_, err = e.svc.VerifyRegistration(ctx, "other@example.com", testCode)
	assert.ErrorIs(t, err, ErrInvalidCode, "a code is bound to its email")
}

func TestAResetCodeCannotCompleteASignup(t *testing.T) {
	e := newEnv()
	require.NoError(t, e.svc.Register(ctx, valid))
	// Same email and same code string, but issued for another purpose.
	e.store.entries = map[string]*storedCode{}
	_, err := e.otp.issue(ctx, PurposeReset, "ana@example.com", "")
	require.NoError(t, err)
	_, err = e.svc.VerifyRegistration(ctx, valid.Email, testCode)
	assert.ErrorIs(t, err, ErrInvalidCode)
}

// The address is only held by someone who proves they own it.
func TestNobodyCanSquatAnAddressTheyDoNotOwn(t *testing.T) {
	e := newEnv()
	// An attacker registers somebody else's address and never gets the code.
	attacker := valid
	attacker.Password = "attacker-pass"
	require.NoError(t, e.svc.Register(ctx, attacker))
	assert.Empty(t, e.repo.users, "nothing reserved the address")

	// The real owner can still use it, with Google as well.
	g := NewGoogleService(e.repo, &fakeGoogleAuth{id: ana}, fakeTokens{}, newFakeRefresh(), e.mailer)
	s, err := g.Login(ctx, "code")
	require.NoError(t, err)
	assert.Equal(t, "ana@example.com", s.User.Email)

	// And the attacker's pending signup can no longer take the address.
	_, err = e.svc.VerifyRegistration(ctx, valid.Email, testCode)
	assert.ErrorIs(t, err, ErrEmailTaken)
	assert.Len(t, e.repo.users, 1)
}

func TestRegisterValidation(t *testing.T) {
	tests := map[string]struct {
		mutate func(*RegisterInput)
		want   error
	}{
		"bad email":      {func(i *RegisterInput) { i.Email = "nope" }, ErrInvalidEmail},
		"display name":   {func(i *RegisterInput) { i.Email = "Ana <ana@example.com>" }, ErrInvalidEmail},
		"short password": {func(i *RegisterInput) { i.Password = "short" }, ErrWeakPassword},
		"long password":  {func(i *RegisterInput) { i.Password = strings.Repeat("a", 129) }, ErrWeakPassword},
		"empty name":     {func(i *RegisterInput) { i.FirstName = " " }, ErrInvalidName},
		"long last name": {func(i *RegisterInput) { i.LastName = strings.Repeat("a", 256) }, ErrInvalidName},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			e := newEnv()
			in := valid
			tc.mutate(&in)
			assert.ErrorIs(t, e.svc.Register(ctx, in), tc.want)
			assert.Empty(t, e.mailer.sent)
			assert.Empty(t, e.store.entries)
		})
	}
}

func TestRegisterEmailTaken(t *testing.T) {
	e := newEnv()
	e.signUp(t, valid)
	in := valid
	in.Email = "ANA@example.com"
	assert.ErrorIs(t, e.svc.Register(ctx, in), ErrEmailTaken)
	assert.Empty(t, e.mailer.sent)
}

func TestRegisterAgainBeforeVerifyingIsRateLimited(t *testing.T) {
	e := newEnv()
	require.NoError(t, e.svc.Register(ctx, valid))
	assert.ErrorIs(t, e.svc.Register(ctx, valid), ErrCodeTooSoon)
	assert.Len(t, e.mailer.sent, 1)
}

func TestRegisterSurvivesMailFailure(t *testing.T) {
	e := newEnv()
	e.mailer.err = errors.New("provider down")
	assert.NoError(t, e.svc.Register(ctx, valid), "a failing mailer must not fail the call")
	_, err := e.svc.VerifyRegistration(ctx, valid.Email, testCode)
	assert.NoError(t, err, "welcome email failure does not block the account either")
}

func TestRegisterStoreFailureIsReported(t *testing.T) {
	e := newEnv()
	e.store.putErr = errors.New("redis down")
	assert.ErrorIs(t, e.svc.Register(ctx, valid), e.store.putErr)
	assert.Empty(t, e.mailer.sent)
}

func TestLogin(t *testing.T) {
	e := newEnv()
	u := e.signUp(t, valid)
	s, err := e.svc.Login(ctx, "ANA@example.com", "s3cretpass")
	require.NoError(t, err)
	assert.Equal(t, u.ID, s.User.ID)
	assert.Equal(t, "tok:1", s.Token.Value)
	assert.NotEmpty(t, s.Refresh.Token, "login hands out a refresh token too")
	assert.False(t, s.Refresh.ExpiresAt.IsZero())
}

func TestRefreshRotatesTheTokenAndIssuesANewAccessToken(t *testing.T) {
	e := newEnv()
	u := e.signUp(t, valid)
	login, err := e.svc.Login(ctx, "ana@example.com", "s3cretpass")
	require.NoError(t, err)

	s, err := e.svc.Refresh(ctx, login.Refresh.Token)
	require.NoError(t, err)
	assert.Equal(t, u.ID, s.User.ID)
	assert.Equal(t, "tok:1", s.Token.Value)
	assert.NotEqual(t, login.Refresh.Token, s.Refresh.Token, "the refresh token is replaced")

	_, err = e.svc.Refresh(ctx, login.Refresh.Token)
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials, "each refresh token works once")
	_, err = e.svc.Refresh(ctx, s.Refresh.Token)
	assert.NoError(t, err, "the new one works")
	_, err = e.svc.Refresh(ctx, "rft_nope")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestRefreshForADeletedUser(t *testing.T) {
	e := newEnv()
	u := e.signUp(t, valid)
	login, err := e.svc.Login(ctx, "ana@example.com", "s3cretpass")
	require.NoError(t, err)
	delete(e.repo.users, u.ID)
	_, err = e.svc.Refresh(ctx, login.Refresh.Token)
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestLogoutRevokesTheRefreshToken(t *testing.T) {
	e := newEnv()
	e.signUp(t, valid)
	login, err := e.svc.Login(ctx, "ana@example.com", "s3cretpass")
	require.NoError(t, err)
	require.NoError(t, e.svc.Logout(ctx, login.Refresh.Token))
	_, err = e.svc.Refresh(ctx, login.Refresh.Token)
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	assert.NoError(t, e.svc.Logout(ctx, "rft_unknown"))
}

func TestLoginFailuresAreIndistinguishable(t *testing.T) {
	e := newEnv()
	e.signUp(t, valid)
	for name, c := range map[string][2]string{
		"wrong password": {"ana@example.com", "wrongpass1"},
		"unknown email":  {"who@example.com", "s3cretpass"},
		"invalid email":  {"nope", "s3cretpass"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := e.svc.Login(ctx, c[0], c[1])
			assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
		})
	}
}

func TestLoginWithoutPasswordAccount(t *testing.T) {
	e := newEnv()
	u := e.signUp(t, valid)
	e.repo.accounts[u.ID] = Account{UserID: u.ID, Provider: ProviderGoogle}
	_, err := e.svc.Login(ctx, "ana@example.com", "s3cretpass")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestLoginSendsAlertAndSurvivesMailFailure(t *testing.T) {
	e := newEnv()
	e.signUp(t, valid)
	e.mailer.err = errors.New("provider down")
	s, err := e.svc.Login(ctx, "ana@example.com", "s3cretpass")
	require.NoError(t, err, "a failing mailer must not fail the login")
	assert.NotEmpty(t, s.Token.Value)
	require.Len(t, e.mailer.sent, 1)
	assert.Equal(t, "LOGIN", e.mailer.sent[0].code)
	assert.Equal(t, "ana@example.com", e.mailer.sent[0].to)
	assert.Equal(t, "Ana", e.mailer.sent[0].data["FirstName"])
	assert.NotEmpty(t, e.mailer.sent[0].data["Time"])
}

func TestFailedLoginSendsNoMail(t *testing.T) {
	e := newEnv()
	e.signUp(t, valid)
	_, err := e.svc.Login(ctx, "ana@example.com", "wrongpass1")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	assert.Empty(t, e.mailer.sent)
}

func TestAuthenticate(t *testing.T) {
	e := newEnv()
	u := e.signUp(t, valid)
	s, err := e.svc.Login(ctx, "ana@example.com", "s3cretpass")
	require.NoError(t, err)

	got, err := e.svc.Authenticate(ctx, s.Token.Value)
	require.NoError(t, err)
	assert.Equal(t, u.ID, got.ID)
	assert.True(t, got.EmailVerified)

	_, err = e.svc.Authenticate(ctx, "tok:99") // user no longer exists
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	_, err = e.svc.Authenticate(ctx, "tok:abc") // non numeric subject
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	_, err = e.svc.Authenticate(ctx, "bad")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

// Regression: `now: time.Now().UTC` froze the clock at construction time.
func TestClockAdvancesAndIsUTC(t *testing.T) {
	s := NewService(newFakeRepo(), fakeHasher{}, fakeTokens{}, newFakeRefresh(), &fakeMailer{}, nil)
	a := s.now()
	time.Sleep(5 * time.Millisecond)
	b := s.now()
	assert.True(t, b.After(a), "the clock must keep moving")
	assert.Equal(t, time.UTC, a.Location())
}
