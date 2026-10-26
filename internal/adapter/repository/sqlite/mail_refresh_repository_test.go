package sqlite

import (
	"context"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/org"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRefreshTokenRepository(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewRefreshTokenRepository(db)
	users := NewUserRepository(db)
	ana, bob := newUser(t, users, "ana@example.com"), newUser(t, users, "bob@example.com")
	orgs := NewOrgRepository(db)
	now := time.Now().UTC().Truncate(time.Millisecond)
	o1, err := orgs.CreateWithOwner(ctx, org.Organization{Name: "One", CreatedAt: now}, ana.ID)
	require.NoError(t, err)
	o2, err := orgs.CreateWithOwner(ctx, org.Organization{Name: "Two", CreatedAt: now}, ana.ID)
	require.NoError(t, err)

	mk := func(userID, tenantID int64, hash string) auth.RefreshToken {
		tok, err := repo.Create(ctx, auth.RefreshToken{
			UserID: userID, TenantID: tenantID, TokenHash: hash, ExpiresAt: now.Add(time.Hour), CreatedAt: now,
		})
		require.NoError(t, err)
		return tok
	}
	a1 := mk(ana.ID, o1.ID, "h-a1")
	mk(ana.ID, o2.ID, "h-a2")
	mk(ana.ID, o1.ID, "h-a3")
	mk(bob.ID, o1.ID, "h-b1")

	got, err := repo.FindByHash(ctx, "h-a1")
	require.NoError(t, err)
	assert.Equal(t, a1.ID, got.ID)
	assert.Nil(t, got.RevokedAt)
	assert.True(t, got.ExpiresAt.Equal(now.Add(time.Hour)))
	_, err = repo.FindByHash(ctx, "nope")
	assert.ErrorIs(t, err, auth.ErrRefreshTokenNotFound)

	// Revoke one token, twice: idempotent, keeps the first time.
	require.NoError(t, repo.Revoke(ctx, a1.ID))
	first, _ := repo.FindByHash(ctx, "h-a1")
	require.NotNil(t, first.RevokedAt)
	require.NoError(t, repo.Revoke(ctx, a1.ID))
	again, _ := repo.FindByHash(ctx, "h-a1")
	assert.True(t, first.RevokedAt.Equal(*again.RevokedAt))
	assert.ErrorIs(t, repo.Revoke(ctx, 999), auth.ErrRefreshTokenNotFound)

	// Revoking a member in one tenant touches only that user in that tenant.
	require.NoError(t, repo.RevokeForMember(ctx, ana.ID, o2.ID))
	for hash, wantRevoked := range map[string]bool{"h-a1": true, "h-a2": true, "h-a3": false, "h-b1": false} {
		tok, err := repo.FindByHash(ctx, hash)
		require.NoError(t, err)
		assert.Equal(t, wantRevoked, tok.RevokedAt != nil, hash)
	}
	assert.NoError(t, repo.RevokeForMember(ctx, 999, 999), "no tokens is not an error")

	// Revoking a user touches every tenant, and only that user.
	require.NoError(t, repo.RevokeForUser(ctx, ana.ID))
	for hash, wantRevoked := range map[string]bool{"h-a1": true, "h-a2": true, "h-a3": true, "h-b1": false} {
		tok, err := repo.FindByHash(ctx, hash)
		require.NoError(t, err)
		assert.Equal(t, wantRevoked, tok.RevokedAt != nil, hash)
	}
	assert.NoError(t, repo.RevokeForUser(ctx, 999))
}

func TestRefreshTokensDieWithTheirOrganization(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewRefreshTokenRepository(db)
	ana := newUser(t, NewUserRepository(db), "ana@example.com")
	now := time.Now().UTC()
	o, err := NewOrgRepository(db).CreateWithOwner(ctx, org.Organization{Name: "One", CreatedAt: now}, ana.ID)
	require.NoError(t, err)
	_, err = repo.Create(ctx, auth.RefreshToken{UserID: ana.ID, TenantID: o.ID, TokenHash: "h", ExpiresAt: now.Add(time.Hour), CreatedAt: now})
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `DELETE FROM organizations WHERE id = ?`, o.ID)
	require.NoError(t, err)
	_, err = repo.FindByHash(ctx, "h")
	assert.ErrorIs(t, err, auth.ErrRefreshTokenNotFound)
}

func TestEmailTemplateRepository(t *testing.T) {
	ctx := context.Background()
	repo := NewEmailTemplateRepository(newDB(t))
	for _, code := range []string{mailing.TemplateWelcome, mailing.TemplateLogin, mailing.TemplateInvitation, mailing.TemplatePasswordReset} {
		tpl, err := repo.FindByCode(ctx, code)
		require.NoError(t, err, code)
		assert.Equal(t, code, tpl.Code)
		assert.NotEmpty(t, tpl.Subject)
		assert.NotEmpty(t, tpl.BodyHTML)
		assert.NotEmpty(t, tpl.BodyText)
	}
	_, err := repo.FindByCode(ctx, "NOPE")
	assert.ErrorIs(t, err, mailing.ErrTemplateNotFound)
}

type captureSender struct{ sent []mailing.Message }

func (c *captureSender) Send(_ context.Context, m mailing.Message) error {
	c.sent = append(c.sent, m)
	return nil
}

// The seeded templates must render with exactly the data the services send.
func TestSeededTemplatesRenderWithServiceData(t *testing.T) {
	ctx := context.Background()
	sender := &captureSender{}
	svc := mailing.NewService(NewEmailTemplateRepository(newDB(t)), sender, "https://app.example.com")

	cases := map[string]map[string]string{
		mailing.TemplateWelcome:       {"FirstName": "Ana", "LastName": "Lopez"},
		mailing.TemplateLogin:         {"FirstName": "Ana", "Time": "Mon, 26 Oct 2026 10:00:00 UTC"},
		mailing.TemplatePasswordReset: {"FirstName": "Ana", "Code": "123456", "ExpiresInMinutes": "10", "MaxAttempts": "3"},
		mailing.TemplateInvitation:    {"InviterName": "Owner", "OrganizationName": "Acme", "InvitationID": "7", "ExpiresAt": "2026-11-02"},
	}
	for code, data := range cases {
		require.NoError(t, svc.Send(ctx, code, "ana@example.com", data), code)
	}
	require.Len(t, sender.sent, 4)
	for _, m := range sender.sent {
		assert.NotEmpty(t, m.Subject)
		assert.NotContains(t, m.HTML+m.Text+m.Subject, "<no value>")
	}
	var invitation mailing.Message
	for _, m := range sender.sent {
		if m.Subject == "Owner invited you to Acme" {
			invitation = m
		}
	}
	assert.Contains(t, invitation.HTML, "https://app.example.com/invitations/7")
}

func TestUserRepositoryGoogleAccount(t *testing.T) {
	ctx := context.Background()
	repo := NewUserRepository(newDB(t))
	now := time.Now().UTC().Truncate(time.Millisecond)

	_, err := repo.FindAccountByProvider(ctx, user.ProviderGoogle, "g-1")
	assert.ErrorIs(t, err, user.ErrNotFound)

	u, err := repo.Create(ctx,
		user.User{Email: "g@example.com", EmailVerified: true, FirstName: "G", LastName: "U", ImageURL: "https://img/g.png", CreatedAt: now},
		user.Account{AccountID: "g-1", Provider: user.ProviderGoogle, CreatedAt: now})
	require.NoError(t, err)

	acc, err := repo.FindAccountByProvider(ctx, user.ProviderGoogle, "g-1")
	require.NoError(t, err)
	assert.Equal(t, u.ID, acc.UserID)
	assert.Empty(t, acc.PasswordHash)
	got, err := repo.FindByID(ctx, u.ID)
	require.NoError(t, err)
	assert.True(t, got.EmailVerified)
	assert.Equal(t, "https://img/g.png", got.ImageURL)

	_, err = repo.FindAccount(ctx, u.ID, user.ProviderDefault)
	assert.ErrorIs(t, err, user.ErrNotFound, "a Google user has no password account")

	// The same address cannot be registered again with another method.
	_, err = repo.Create(ctx,
		user.User{Email: "G@Example.com", FirstName: "G", LastName: "U", CreatedAt: now},
		user.Account{AccountID: "g@example.com", Provider: user.ProviderDefault, PasswordHash: "h", CreatedAt: now})
	assert.ErrorIs(t, err, user.ErrEmailTaken)
}

func TestUserRepositoryUpdatePassword(t *testing.T) {
	ctx := context.Background()
	repo := NewUserRepository(newDB(t))
	u := newUser(t, repo, "ana@example.com")

	require.NoError(t, repo.UpdatePassword(ctx, u.ID, "new-hash"))
	acc, err := repo.FindAccount(ctx, u.ID, user.ProviderDefault)
	require.NoError(t, err)
	assert.Equal(t, "new-hash", acc.PasswordHash)

	assert.ErrorIs(t, repo.UpdatePassword(ctx, 999, "x"), user.ErrNotFound)

	// A Google-only user has no password account to update.
	g, err := repo.Create(ctx,
		user.User{Email: "g@example.com", FirstName: "G", LastName: "U", CreatedAt: time.Now().UTC()},
		user.Account{AccountID: "g-9", Provider: user.ProviderGoogle, CreatedAt: time.Now().UTC()})
	require.NoError(t, err)
	assert.ErrorIs(t, repo.UpdatePassword(ctx, g.ID, "x"), user.ErrNotFound)
}
