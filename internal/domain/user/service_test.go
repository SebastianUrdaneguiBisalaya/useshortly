package user

import (
	"context"
	"errors"
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
	u.ID, a.UserID = r.nextID, r.nextID
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

func (r *fakeRepo) UpdatePassword(_ context.Context, userID int64, hash string) error {
	a, ok := r.accounts[userID]
	if !ok || a.Provider != ProviderDefault {
		return ErrNotFound
	}
	a.PasswordHash = hash
	r.accounts[userID] = a
	return nil
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
	data     map[string]string
}

type fakeMailer struct {
	sent []sentMail
	err  error
}

func (m *fakeMailer) Send(_ context.Context, code, to string, data map[string]string) error {
	m.sent = append(m.sent, sentMail{code, to, data})
	return m.err
}

func newService() (*Service, *fakeRepo) {
	svc, repo, _ := newServiceWithMailer()
	return svc, repo
}

func newServiceWithMailer() (*Service, *fakeRepo, *fakeMailer) {
	repo, mailer := newFakeRepo(), &fakeMailer{}
	return NewService(repo, fakeHasher{}, fakeTokens{}, mailer), repo, mailer
}

var valid = RegisterInput{Email: "  Ana@Example.com ", Password: "s3cretpass", FirstName: "Ana", LastName: "Lopez"}

func TestRegister(t *testing.T) {
	svc, repo := newService()
	u, err := svc.Register(context.Background(), valid)
	require.NoError(t, err)
	assert.Equal(t, "ana@example.com", u.Email)
	assert.NotZero(t, u.ID)
	acc := repo.accounts[u.ID]
	assert.Equal(t, ProviderDefault, acc.Provider)
	assert.Equal(t, "hash:s3cretpass", acc.PasswordHash)
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
			svc, _ := newService()
			in := valid
			tc.mutate(&in)
			_, err := svc.Register(context.Background(), in)
			assert.ErrorIs(t, err, tc.want)
		})
	}
}

func TestRegisterEmailTaken(t *testing.T) {
	svc, _ := newService()
	_, err := svc.Register(context.Background(), valid)
	require.NoError(t, err)
	in := valid
	in.Email = "ANA@example.com"
	_, err = svc.Register(context.Background(), in)
	assert.ErrorIs(t, err, ErrEmailTaken)
}

func TestLogin(t *testing.T) {
	svc, _ := newService()
	u, err := svc.Register(context.Background(), valid)
	require.NoError(t, err)
	s, err := svc.Login(context.Background(), "ANA@example.com", "s3cretpass")
	require.NoError(t, err)
	assert.Equal(t, u.ID, s.User.ID)
	assert.Equal(t, "tok:1", s.Token.Value)
}

func TestLoginFailuresAreIndistinguishable(t *testing.T) {
	svc, _ := newService()
	_, err := svc.Register(context.Background(), valid)
	require.NoError(t, err)
	for name, c := range map[string][2]string{
		"wrong password": {"ana@example.com", "wrongpass1"},
		"unknown email":  {"who@example.com", "s3cretpass"},
		"invalid email":  {"nope", "s3cretpass"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := svc.Login(context.Background(), c[0], c[1])
			assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
		})
	}
}

func TestLoginWithoutPasswordAccount(t *testing.T) {
	svc, repo := newService()
	u, err := svc.Register(context.Background(), valid)
	require.NoError(t, err)
	repo.accounts[u.ID] = Account{UserID: u.ID, Provider: ProviderGoogle}
	_, err = svc.Login(context.Background(), "ana@example.com", "s3cretpass")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestAuthenticate(t *testing.T) {
	svc, _ := newService()
	u, err := svc.Register(context.Background(), valid)
	require.NoError(t, err)
	s, err := svc.Login(context.Background(), "ana@example.com", "s3cretpass")
	require.NoError(t, err)

	got, err := svc.Authenticate(context.Background(), s.Token.Value)
	require.NoError(t, err)
	assert.Equal(t, u.ID, got.ID)

	_, err = svc.Authenticate(context.Background(), "tok:99") // user no longer exists
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	_, err = svc.Authenticate(context.Background(), "tok:abc") // non numeric subject
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	_, err = svc.Authenticate(context.Background(), "bad")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestRegisterAndLoginSendEmailsAndSurviveMailFailure(t *testing.T) {
	svc, _, mailer := newServiceWithMailer()
	_, err := svc.Register(context.Background(), valid)
	require.NoError(t, err)
	require.Len(t, mailer.sent, 1)
	assert.Equal(t, "WELCOME", mailer.sent[0].code)
	assert.Equal(t, "ana@example.com", mailer.sent[0].to)
	assert.Equal(t, "Ana", mailer.sent[0].data["FirstName"])
	mailer.sent = nil

	mailer.err = errors.New("provider down")
	s, err := svc.Login(context.Background(), "ana@example.com", "s3cretpass")
	require.NoError(t, err, "a failing mailer must not fail the login")
	assert.NotEmpty(t, s.Token.Value)
	require.Len(t, mailer.sent, 1)
	assert.Equal(t, "LOGIN", mailer.sent[0].code)
	assert.Equal(t, "ana@example.com", mailer.sent[0].to)
	assert.Equal(t, "Ana", mailer.sent[0].data["FirstName"])
	assert.NotEmpty(t, mailer.sent[0].data["Time"])
}

func TestFailedLoginSendsNoMail(t *testing.T) {
	svc, _, mailer := newServiceWithMailer()
	_, err := svc.Register(context.Background(), valid)
	require.NoError(t, err)
	mailer.sent = nil // ignore the welcome email
	_, err = svc.Login(context.Background(), "ana@example.com", "wrongpass1")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	assert.Empty(t, mailer.sent)
}

func TestRegisterSurvivesMailFailure(t *testing.T) {
	svc, repo, mailer := newServiceWithMailer()
	mailer.err = errors.New("provider down")
	u, err := svc.Register(context.Background(), valid)
	require.NoError(t, err, "a failing mailer must not block the account creation")
	assert.Contains(t, repo.users, u.ID)
}

func TestFailedRegisterSendsNoMail(t *testing.T) {
	svc, _, mailer := newServiceWithMailer()
	in := valid
	in.Email = "nope"
	_, err := svc.Register(context.Background(), in)
	assert.ErrorIs(t, err, ErrInvalidEmail)
	assert.Empty(t, mailer.sent)
}
