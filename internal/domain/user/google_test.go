package user

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeGoogleAuth struct {
	id   GoogleIdentity
	err  error
	code string
}

func (f *fakeGoogleAuth) Exchange(_ context.Context, code string) (GoogleIdentity, error) {
	f.code = code
	return f.id, f.err
}

var ana = GoogleIdentity{
	Subject: "g-123", Email: "Ana@Example.com", EmailVerified: true,
	FirstName: "Ana", LastName: "Lopez", PictureURL: "https://img/a.png",
	Scope: "openid email profile",
}

func newGoogle(id GoogleIdentity, gerr error) (*GoogleService, *fakeRepo, *fakeMailer, *fakeGoogleAuth) {
	repo, mailer := newFakeRepo(), &fakeMailer{}
	g := &fakeGoogleAuth{id: id, err: gerr}
	return NewGoogleService(repo, g, fakeTokens{}, newFakeRefresh(), mailer), repo, mailer, g
}

func TestGoogleLoginCreatesUserOnFirstUse(t *testing.T) {
	svc, repo, mailer, g := newGoogle(ana, nil)
	s, err := svc.Login(context.Background(), "the-code")
	require.NoError(t, err)
	assert.Equal(t, "the-code", g.code)
	assert.Equal(t, "ana@example.com", s.User.Email)
	assert.True(t, s.User.EmailVerified)
	assert.Equal(t, "https://img/a.png", s.User.ImageURL)
	assert.Equal(t, "tok:1", s.Token.Value)
	assert.Equal(t, "rft_1", s.Refresh.Token, "Google sign-in opens a full session")

	acc := repo.accounts[s.User.ID]
	assert.Equal(t, ProviderGoogle, acc.Provider)
	assert.Equal(t, "g-123", acc.AccountID)
	assert.Equal(t, "openid email profile", acc.Scope, "the granted scope is saved on the account")
	assert.Nil(t, acc.UpdatedAt)
	assert.Empty(t, acc.PasswordHash)

	require.Len(t, mailer.sent, 1)
	assert.Equal(t, "WELCOME", mailer.sent[0].code)
}

func TestGoogleLoginSecondTimeSignsInTheSameUser(t *testing.T) {
	svc, repo, mailer, _ := newGoogle(ana, nil)
	first, err := svc.Login(context.Background(), "c1")
	require.NoError(t, err)
	second, err := svc.Login(context.Background(), "c2")
	require.NoError(t, err)
	assert.Equal(t, first.User.ID, second.User.ID)
	assert.Len(t, repo.users, 1)
	require.Len(t, mailer.sent, 2)
	assert.Equal(t, "LOGIN", mailer.sent[1].code)
	assert.Nil(t, repo.accounts[first.User.ID].UpdatedAt, "an unchanged scope writes nothing")
}

func TestGoogleLoginRefreshesTheScopeWhenItChanges(t *testing.T) {
	svc, repo, _, g := newGoogle(ana, nil)
	fixed := time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)
	svc.now = func() time.Time { return fixed }
	first, err := svc.Login(context.Background(), "c1")
	require.NoError(t, err)

	g.id.Scope = "openid email profile https://www.googleapis.com/auth/calendar.readonly"
	_, err = svc.Login(context.Background(), "c2")
	require.NoError(t, err)

	acc := repo.accounts[first.User.ID]
	assert.Equal(t, g.id.Scope, acc.Scope)
	require.NotNil(t, acc.UpdatedAt)
	assert.Equal(t, fixed, *acc.UpdatedAt, "updated_at is stamped with the service clock, in UTC")
}

func TestGoogleLoginRefusesEmailRegisteredWithPassword(t *testing.T) {
	svc, repo, mailer, _ := newGoogle(ana, nil)
	newEnvWithRepo(repo).signUp(t, valid) // ana@example.com with a password

	_, err := svc.Login(context.Background(), "code")
	assert.ErrorIs(t, err, ErrProviderMismatch)
	assert.Len(t, repo.users, 1, "no second user, no merged account")
	assert.Equal(t, ProviderDefault, repo.accounts[1].Provider)
	assert.Empty(t, mailer.sent)
}

func TestPasswordSignupRefusesEmailRegisteredWithGoogle(t *testing.T) {
	svc, repo, _, _ := newGoogle(ana, nil)
	_, err := svc.Login(context.Background(), "code")
	require.NoError(t, err)

	err = newEnvWithRepo(repo).svc.Register(context.Background(), valid)
	assert.ErrorIs(t, err, ErrEmailTaken)
}

func TestGooglePasswordLoginIsNotPossible(t *testing.T) {
	svc, repo, _, _ := newGoogle(ana, nil)
	_, err := svc.Login(context.Background(), "code")
	require.NoError(t, err)

	_, err = newEnvWithRepo(repo).svc.Login(context.Background(), "ana@example.com", "anything-at-all")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

// racyRepo reports the email as free, then loses the race on Create.
type racyRepo struct{ *fakeRepo }

func (racyRepo) FindByEmail(context.Context, string) (User, error)   { return User{}, ErrNotFound }
func (racyRepo) Create(context.Context, User, Account) (User, error) { return User{}, ErrEmailTaken }

func TestGoogleLoginLosingTheCreationRaceIsAMismatch(t *testing.T) {
	svc := NewGoogleService(racyRepo{newFakeRepo()}, &fakeGoogleAuth{id: ana}, fakeTokens{}, newFakeRefresh(), &fakeMailer{})
	_, err := svc.Login(context.Background(), "code")
	assert.ErrorIs(t, err, ErrProviderMismatch)
}

func TestGoogleLoginRefusesUnverifiedEmail(t *testing.T) {
	unverified := ana
	unverified.EmailVerified = false
	svc, repo, mailer, _ := newGoogle(unverified, nil)
	_, err := svc.Login(context.Background(), "code")
	assert.ErrorIs(t, err, ErrGoogleEmailNotVerified)
	assert.Empty(t, repo.users)
	assert.Empty(t, mailer.sent)
}

func TestGoogleLoginRejectsInvalidCodeAndIdentity(t *testing.T) {
	svc, repo, _, _ := newGoogle(GoogleIdentity{}, auth.ErrInvalidCredentials)
	_, err := svc.Login(context.Background(), "bad")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)

	noSub := ana
	noSub.Subject = ""
	svc, repo, _, _ = newGoogle(noSub, nil)
	_, err = svc.Login(context.Background(), "code")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)

	badEmail := ana
	badEmail.Email = "nope"
	svc, repo, _, _ = newGoogle(badEmail, nil)
	_, err = svc.Login(context.Background(), "code")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	assert.Empty(t, repo.users)
}

func TestGoogleLoginFallsBackToEmailForMissingName(t *testing.T) {
	noName := ana
	noName.FirstName, noName.LastName = " ", ""
	svc, _, _, _ := newGoogle(noName, nil)
	s, err := svc.Login(context.Background(), "code")
	require.NoError(t, err)
	assert.Equal(t, "ana", s.User.FirstName)
}

func TestGoogleLoginSurvivesMailFailure(t *testing.T) {
	svc, repo, mailer, _ := newGoogle(ana, nil)
	mailer.err = errors.New("provider down")
	_, err := svc.Login(context.Background(), "code")
	require.NoError(t, err)
	assert.Len(t, repo.users, 1)
}

// Regression: `now: time.Now().UTC` froze the clock at construction time.
func TestGoogleClockAdvancesAndIsUTC(t *testing.T) {
	s := NewGoogleService(nil, nil, nil, nil, nil)
	a := s.now()
	time.Sleep(5 * time.Millisecond)
	b := s.now()
	assert.True(t, b.After(a), "the clock must keep moving")
	assert.Equal(t, time.UTC, a.Location())
}
