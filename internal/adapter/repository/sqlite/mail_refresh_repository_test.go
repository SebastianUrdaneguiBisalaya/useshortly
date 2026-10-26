package sqlite

import (
	"context"
	"database/sql"
	"errors"
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
	for _, code := range []string{mailing.TemplateWelcome, mailing.TemplateLogin, mailing.TemplateInvitation, mailing.TemplatePasswordReset, mailing.TemplateVerifyEmail} {
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

type captureSender struct {
	sent []mailing.Message
	err  error
}

func (c *captureSender) Send(_ context.Context, m mailing.Message) (mailing.Receipt, error) {
	if c.err != nil {
		return mailing.Receipt{Provider: "FAKE"}, c.err
	}
	c.sent = append(c.sent, m)
	return mailing.Receipt{Provider: "FAKE", ProviderID: "prov-" + m.To}, nil
}

// The seeded templates must render with exactly the data the services send.
func TestSeededTemplatesRenderWithServiceData(t *testing.T) {
	ctx := context.Background()
	sender := &captureSender{}
	db := newDB(t)
	svc := mailing.NewService(NewEmailTemplateRepository(db), NewEmailLogRepository(db), sender, "https://app.example.com")

	cases := map[string]map[string]string{
		mailing.TemplateWelcome:       {"FirstName": "Ana", "LastName": "Lopez"},
		mailing.TemplateLogin:         {"FirstName": "Ana", "Time": "Mon, 26 Oct 2026 10:00:00 UTC"},
		mailing.TemplateVerifyEmail:   {"FirstName": "Ana", "Code": "123456", "ExpiresInMinutes": "10", "MaxAttempts": "3"},
		mailing.TemplatePasswordReset: {"FirstName": "Ana", "Code": "123456", "ExpiresInMinutes": "10", "MaxAttempts": "3"},
		mailing.TemplateInvitation:    {"InviterName": "Owner", "OrganizationName": "Acme", "InvitationID": "7", "ExpiresAt": "2026-11-02"},
	}
	for code, data := range cases {
		require.NoError(t, svc.Send(ctx, mailing.Request{Code: code, To: "ana@example.com", Data: data}), code)
	}
	require.Len(t, sender.sent, 5)
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

type logRow struct {
	template, to                  string
	cc, bcc, providerID, errorMsg sql.NullString
	status, provider              string
}

func readLogs(t *testing.T, db *sql.DB) []logRow {
	t.Helper()
	rows, err := db.QueryContext(context.Background(),
		`SELECT t.code, l.to_email, l.cc, l.bcc, l.status, l.email_provider, l.email_provider_id, l.error_metadata
		 FROM email_logs l JOIN email_templates t ON t.id = l.template_id ORDER BY l.id`)
	require.NoError(t, err)
	defer rows.Close()
	var out []logRow
	for rows.Next() {
		var r logRow
		require.NoError(t, rows.Scan(&r.template, &r.to, &r.cc, &r.bcc, &r.status, &r.provider, &r.providerID, &r.errorMsg))
		out = append(out, r)
	}
	require.NoError(t, rows.Err())
	return out
}

func TestEmailLogsRecordSuccessWithTheProviderID(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	sender := &captureSender{}
	svc := mailing.NewService(NewEmailTemplateRepository(db), NewEmailLogRepository(db), sender, "https://app.example.com")

	require.NoError(t, svc.Send(ctx, mailing.Request{
		Code: mailing.TemplateInvitation, To: "bob@example.com",
		CC: []string{"boss@example.com"}, BCC: []string{"audit@example.com", "ceo@example.com"},
		Data: map[string]string{"InviterName": "Owner", "OrganizationName": "Acme", "InvitationID": "7", "ExpiresAt": "2026-11-02"},
	}))
	require.NoError(t, svc.Send(ctx, mailing.Request{
		Code: mailing.TemplateLogin, To: "ana@example.com", Data: map[string]string{"FirstName": "Ana", "Time": "now"},
	}))

	logs := readLogs(t, db)
	require.Len(t, logs, 2)
	assert.Equal(t, "INVITATION", logs[0].template)
	assert.Equal(t, "bob@example.com", logs[0].to)
	assert.Equal(t, `["boss@example.com"]`, logs[0].cc.String)
	assert.Equal(t, `["audit@example.com","ceo@example.com"]`, logs[0].bcc.String)
	assert.Equal(t, "SENT", logs[0].status)
	assert.Equal(t, "FAKE", logs[0].provider)
	assert.Equal(t, "prov-bob@example.com", logs[0].providerID.String)
	assert.False(t, logs[0].errorMsg.Valid)

	assert.False(t, logs[1].cc.Valid, "no copies is NULL, not []")
	assert.False(t, logs[1].bcc.Valid)
}

func TestEmailLogsRecordFailuresWithTheProviderError(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	sender := &captureSender{err: &mailing.ProviderError{
		Type: mailing.ErrorTypeValidation, Code: "validation_error", Message: "The from address is invalid",
	}}
	svc := mailing.NewService(NewEmailTemplateRepository(db), NewEmailLogRepository(db), sender, "https://app.example.com")

	err := svc.Send(ctx, mailing.Request{Code: mailing.TemplateWelcome, To: "ana@example.com", Data: map[string]string{"FirstName": "Ana", "LastName": "L"}})
	require.ErrorIs(t, err, sender.err)

	logs := readLogs(t, db)
	require.Len(t, logs, 1)
	assert.Equal(t, "FAILED", logs[0].status)
	assert.Equal(t, "FAKE", logs[0].provider)
	assert.False(t, logs[0].providerID.Valid)
	assert.JSONEq(t, `{"type":"validation","code":"validation_error","message":"The from address is invalid"}`, logs[0].errorMsg.String)
}

func TestEmailLogsStoreAPlainErrorAsUnknown(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	sender := &captureSender{err: errors.New("boom")}
	svc := mailing.NewService(NewEmailTemplateRepository(db), NewEmailLogRepository(db), sender, "https://app.example.com")
	require.Error(t, svc.Send(ctx, mailing.Request{Code: mailing.TemplateWelcome, To: "ana@example.com", Data: map[string]string{"FirstName": "Ana", "LastName": "L"}}))

	logs := readLogs(t, db)
	require.Len(t, logs, 1)
	assert.JSONEq(t, `{"type":"unknown","message":"boom"}`, logs[0].errorMsg.String, "no code key when there is none")
}

func TestEmailLogsSurviveDeletingTheUser(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	users := NewUserRepository(db)
	u := newUser(t, users, "ana@example.com")
	svc := mailing.NewService(NewEmailTemplateRepository(db), NewEmailLogRepository(db), &captureSender{}, "https://app.example.com")
	require.NoError(t, svc.Send(ctx, mailing.Request{Code: mailing.TemplateWelcome, To: u.Email, Data: map[string]string{"FirstName": "Ana", "LastName": "L"}}))

	_, err := db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, u.ID)
	require.NoError(t, err)
	assert.Len(t, readLogs(t, db), 1)
}
