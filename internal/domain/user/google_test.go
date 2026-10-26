package user

import (
	"context"
	"errors"
	"testing"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeVerifier struct {
	id  GoogleIdentity
	err error
}

func (f fakeVerifier) Verify(context.Context, string) (GoogleIdentity, error) { return f.id, f.err }

var ana = GoogleIdentity{
	Subject: "g-123", Email: "Ana@Example.com", EmailVerified: true,
	FirstName: "Ana", LastName: "Lopez", PictureURL: "https://img/a.png",
}

func newGoogle(id GoogleIdentity, verr error) (*GoogleService, *fakeRepo, *fakeMailer) {
	repo, mailer := newFakeRepo(), &fakeMailer{}
	return NewGoogleService(repo, fakeVerifier{id, verr}, fakeTokens{}, mailer), repo, mailer
}

func TestGoogleLoginCreatesUserOnFirstUse(t *testing.T) {
	svc, repo, mailer := newGoogle(ana, nil)
	s, err := svc.Login(context.Background(), "idtoken")
	require.NoError(t, err)
	assert.Equal(t, "ana@example.com", s.User.Email)
	assert.True(t, s.User.EmailVerified)
	assert.Equal(t, "https://img/a.png", s.User.ImageURL)
	assert.Equal(t, "tok:1", s.Token.Value)

	acc := repo.accounts[s.User.ID]
	assert.Equal(t, ProviderGoogle, acc.Provider)
	assert.Equal(t, "g-123", acc.AccountID)
	assert.Empty(t, acc.PasswordHash)

	require.Len(t, mailer.sent, 1)
	assert.Equal(t, "WELCOME", mailer.sent[0].code)
}

func TestGoogleLoginSecondTimeSignsInTheSameUser(t *testing.T) {
	svc, repo, mailer := newGoogle(ana, nil)
	first, err := svc.Login(context.Background(), "idtoken")
	require.NoError(t, err)
	second, err := svc.Login(context.Background(), "idtoken")
	require.NoError(t, err)
	assert.Equal(t, first.User.ID, second.User.ID)
	assert.Len(t, repo.users, 1)
	require.Len(t, mailer.sent, 2)
	assert.Equal(t, "LOGIN", mailer.sent[1].code)
}

func TestGoogleLoginLinksToExistingPasswordUser(t *testing.T) {
	svc, repo, _ := newGoogle(ana, nil)
	users := NewService(repo, fakeHasher{}, fakeTokens{}, &fakeMailer{})
	u, err := users.Register(context.Background(), valid) // ana@example.com with a password
	require.NoError(t, err)

	s, err := svc.Login(context.Background(), "idtoken")
	require.NoError(t, err)
	assert.Equal(t, u.ID, s.User.ID, "no duplicate user")
	assert.Len(t, repo.users, 1)
	require.Len(t, repo.extra, 1)
	assert.Equal(t, ProviderGoogle, repo.extra[0].Provider)
	assert.Equal(t, u.ID, repo.extra[0].UserID)
}

func TestGoogleLoginRefusesUnverifiedEmail(t *testing.T) {
	unverified := ana
	unverified.EmailVerified = false
	svc, repo, mailer := newGoogle(unverified, nil)
	_, err := svc.Login(context.Background(), "idtoken")
	assert.ErrorIs(t, err, ErrGoogleEmailNotVerified)
	assert.Empty(t, repo.users)
	assert.Empty(t, mailer.sent)
}

func TestGoogleLoginRejectsInvalidTokenAndIdentity(t *testing.T) {
	svc, repo, _ := newGoogle(GoogleIdentity{}, auth.ErrInvalidCredentials)
	_, err := svc.Login(context.Background(), "bad")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)

	noSub := ana
	noSub.Subject = ""
	svc, repo, _ = newGoogle(noSub, nil)
	_, err = svc.Login(context.Background(), "idtoken")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)

	badEmail := ana
	badEmail.Email = "nope"
	svc, repo, _ = newGoogle(badEmail, nil)
	_, err = svc.Login(context.Background(), "idtoken")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	assert.Empty(t, repo.users)
}

func TestGoogleLoginFallsBackToEmailForMissingName(t *testing.T) {
	noName := ana
	noName.FirstName, noName.LastName = " ", ""
	svc, _, _ := newGoogle(noName, nil)
	s, err := svc.Login(context.Background(), "idtoken")
	require.NoError(t, err)
	assert.Equal(t, "ana", s.User.FirstName)
}

func TestGoogleLoginSurvivesMailFailure(t *testing.T) {
	svc, repo, mailer := newGoogle(ana, nil)
	mailer.err = errors.New("provider down")
	_, err := svc.Login(context.Background(), "idtoken")
	require.NoError(t, err)
	assert.Len(t, repo.users, 1)
}
