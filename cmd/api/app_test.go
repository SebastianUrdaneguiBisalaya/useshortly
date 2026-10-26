package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/config"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/platform/database"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// memCodes is an in-memory user.CodeStore with the same rules as the Redis one.
type memCodes struct {
	mu       sync.Mutex
	entries  map[string]*memCode
	cooldown map[string]bool
}

type memCode struct {
	hash, payload string
	attempts      int
}

func (m *memCodes) Put(_ context.Context, p user.Purpose, email, hash, payload string, _, _ time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := string(p) + ":" + email
	if m.cooldown[k] {
		return user.ErrCodeTooSoon
	}
	m.cooldown[k] = true
	m.entries[k] = &memCode{hash: hash, payload: payload}
	return nil
}

func (m *memCodes) Check(_ context.Context, p user.Purpose, email, hash string, max int) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := string(p) + ":" + email
	e, ok := m.entries[k]
	if !ok {
		return "", user.ErrInvalidCode
	}
	e.attempts++
	if e.hash == hash {
		delete(m.entries, k)
		return e.payload, nil
	}
	if e.attempts >= max {
		delete(m.entries, k)
		return "", user.ErrTooManyAttempts
	}
	return "", user.ErrInvalidCode
}

// outbox records the emails the app "sends".
type outbox struct {
	mu   sync.Mutex
	sent []mailing.Message
}

func (o *outbox) Send(_ context.Context, m mailing.Message) (mailing.Receipt, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.sent = append(o.sent, m)
	return mailing.Receipt{Provider: "TEST", ProviderID: "id-" + strconv.Itoa(len(o.sent))}, nil
}

type fakeGoogle struct{ id user.GoogleIdentity }

func (f fakeGoogle) Verify(_ context.Context, token string) (user.GoogleIdentity, error) {
	if token != "good-token" {
		return user.GoogleIdentity{}, auth.ErrInvalidCredentials
	}
	return f.id, nil
}

type env struct {
	t      *testing.T
	app    *app
	outbox *outbox
	sql    *sql.DB
}

func newEnv(t *testing.T, withGoogle bool) *env {
	t.Helper()
	ctx := context.Background()
	db, err := database.NewSQLite(ctx, database.SQLiteConfig{Path: filepath.Join(t.TempDir(), "app.db")})
	if err != nil {
		t.Skipf("sqlite driver unavailable: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	files, err := filepath.Glob("../../migrations/*.up.sql")
	require.NoError(t, err)
	sort.Strings(files)
	require.NotEmpty(t, files)
	for _, f := range files {
		b, err := os.ReadFile(f)
		require.NoError(t, err)
		_, err = db.DB.ExecContext(ctx, string(b))
		require.NoErrorf(t, err, "apply %s", f)
	}

	box := &outbox{}
	a := adapters{
		codes:  &memCodes{entries: map[string]*memCode{}, cooldown: map[string]bool{}},
		sender: box,
	}
	if withGoogle {
		a.google = fakeGoogle{user.GoogleIdentity{
			Subject: "g-1", Email: "gina@example.com", EmailVerified: true, FirstName: "Gina", LastName: "Google",
		}}
	}
	cfg := &config.Config{
		AppURL:    "http://short.test",
		JWTSecret: "0123456789abcdef0123456789abcdef",
		JWTTTL:    time.Hour,
		OTPSecret: "fedcba9876543210fedcba9876543210",
	}
	e := &env{t: t, app: newApp(cfg, db.DB, a), outbox: box, sql: db.DB}
	t.Cleanup(e.app.mail.Wait)
	return e
}

type response struct {
	status int
	header http.Header
	body   map[string]any
	raw    string
}

func (e *env) do(method, path, token string, body any) response {
	e.t.Helper()
	var rd *bytes.Reader
	switch b := body.(type) {
	case nil:
		rd = bytes.NewReader(nil)
	case string:
		rd = bytes.NewReader([]byte(b))
	default:
		j, err := json.Marshal(b)
		require.NoError(e.t, err)
		rd = bytes.NewReader(j)
	}
	req := httptest.NewRequest(method, path, rd)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.app.handler.ServeHTTP(rec, req)
	res := response{status: rec.Code, header: rec.Header(), raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &res.body)
	return res
}

func (r response) errCode() string {
	if m, ok := r.body["error"].(map[string]any); ok {
		s, _ := m["code"].(string)
		return s
	}
	return ""
}

func (r response) str(key string) string { s, _ := r.body[key].(string); return s }
func (r response) id() string            { return strconv.FormatInt(int64(r.body["id"].(float64)), 10) }

// lastCode waits for the background emails and returns the 6-digit code of the last one to to.
func (e *env) lastCode(to string) string {
	e.t.Helper()
	e.app.mail.Wait()
	e.outbox.mu.Lock()
	defer e.outbox.mu.Unlock()
	for i := len(e.outbox.sent) - 1; i >= 0; i-- {
		if m := e.outbox.sent[i]; m.To == to {
			code := regexp.MustCompile(`\b\d{6}\b`).FindString(m.Text)
			require.NotEmpty(e.t, code, "no code in %q", m.Text)
			return code
		}
	}
	e.t.Fatalf("no email to %s", to)
	return ""
}

func (e *env) emails() []mailing.Message {
	e.app.mail.Wait()
	e.outbox.mu.Lock()
	defer e.outbox.mu.Unlock()
	return append([]mailing.Message(nil), e.outbox.sent...)
}

// signUp registers and verifies an account, returning its token.
func (e *env) signUp(email, first string) string {
	e.t.Helper()
	res := e.do("POST", "/api/v1/auth/register", "", map[string]string{
		"email": email, "password": "s3cretpass", "first_name": first, "last_name": "Tester",
	})
	require.Equal(e.t, http.StatusAccepted, res.status, res.raw)
	res = e.do("POST", "/api/v1/auth/register/verify", "", map[string]string{"email": email, "code": e.lastCode(email)})
	require.Equal(e.t, http.StatusCreated, res.status, res.raw)
	return res.str("token")
}

func (e *env) createOrg(token, name string) string {
	e.t.Helper()
	res := e.do("POST", "/api/v1/orgs", token, map[string]string{"name": name})
	require.Equal(e.t, http.StatusCreated, res.status, res.raw)
	return res.id()
}

func TestHealth(t *testing.T) {
	e := newEnv(t, false)
	res := e.do("GET", "/health", "", nil)
	assert.Equal(t, 200, res.status)
	assert.Equal(t, "OK", res.raw)
}

func TestSignupLoginAndProfile(t *testing.T) {
	e := newEnv(t, false)

	res := e.do("POST", "/api/v1/auth/register", "", map[string]string{
		"email": "Ana@Example.com", "password": "s3cretpass", "first_name": "Ana", "last_name": "Lopez",
	})
	require.Equal(t, http.StatusAccepted, res.status, res.raw)

	// Nothing exists until the code is confirmed.
	assert.Equal(t, http.StatusUnauthorized, e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "ana@example.com", "password": "s3cretpass"}).status)

	code := e.lastCode("ana@example.com")
	wrong := "000000"
	if code == wrong {
		wrong = "000001"
	}
	assert.Equal(t, "invalid_code", e.do("POST", "/api/v1/auth/register/verify", "", map[string]string{"email": "ana@example.com", "code": wrong}).errCode())

	res = e.do("POST", "/api/v1/auth/register/verify", "", map[string]string{"email": "ana@example.com", "code": code})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	assert.NotEmpty(t, res.str("token"))
	assert.NotEmpty(t, res.str("expires_at"))
	assert.Equal(t, "ana@example.com", res.body["user"].(map[string]any)["email"])
	assert.Equal(t, true, res.body["user"].(map[string]any)["email_verified"])

	// The same email cannot be registered again.
	res = e.do("POST", "/api/v1/auth/register", "", map[string]string{"email": "ana@example.com", "password": "s3cretpass", "first_name": "A", "last_name": "B"})
	assert.Equal(t, http.StatusConflict, res.status)
	assert.Equal(t, "email_taken", res.errCode())

	res = e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "ana@example.com", "password": "s3cretpass"})
	require.Equal(t, http.StatusOK, res.status, res.raw)
	token := res.str("token")

	me := e.do("GET", "/api/v1/me", token, nil)
	require.Equal(t, http.StatusOK, me.status)
	assert.Equal(t, "Ana", me.str("first_name"))

	// Welcome and sign-in emails went out too.
	var subjects []string
	for _, m := range e.emails() {
		subjects = append(subjects, m.Subject)
	}
	assert.Contains(t, strings.Join(subjects, "|"), "Welcome")
	assert.Contains(t, strings.Join(subjects, "|"), "New sign-in")
}

func TestLoginFailures(t *testing.T) {
	e := newEnv(t, false)
	e.signUp("ana@example.com", "Ana")
	for name, body := range map[string]map[string]string{
		"wrong password": {"email": "ana@example.com", "password": "wrongpass1"},
		"unknown email":  {"email": "nobody@example.com", "password": "s3cretpass"},
	} {
		res := e.do("POST", "/api/v1/auth/login", "", body)
		assert.Equal(t, http.StatusUnauthorized, res.status, name)
		assert.Equal(t, "invalid_credentials", res.errCode(), name)
	}
}

func TestAuthRequired(t *testing.T) {
	e := newEnv(t, false)
	token := e.signUp("ana@example.com", "Ana")

	for _, p := range []string{"/api/v1/me", "/api/v1/orgs"} {
		res := e.do("GET", p, "", nil)
		assert.Equal(t, http.StatusUnauthorized, res.status, p)
		assert.NotEmpty(t, res.header.Get("WWW-Authenticate"))
		assert.Equal(t, http.StatusUnauthorized, e.do("GET", p, "garbage", nil).status, p)
	}
	assert.Equal(t, http.StatusOK, e.do("GET", "/api/v1/me", token, nil).status)
	assert.Equal(t, http.StatusUnauthorized, e.do("POST", "/api/v1/orgs/1/links", "", map[string]string{"url": "https://example.com"}).status)
}

func TestStrictBodies(t *testing.T) {
	e := newEnv(t, false)
	assert.Equal(t, "invalid_body", e.do("POST", "/api/v1/auth/login", "", `{"email":"a@b.co","password":"x","extra":1}`).errCode(), "unknown field")
	assert.Equal(t, "invalid_body", e.do("POST", "/api/v1/auth/login", "", `not json`).errCode())
	assert.Equal(t, "invalid_body", e.do("POST", "/api/v1/auth/login", "", `{"email":"a@b.co"} {"x":1}`).errCode(), "two values")
	assert.Equal(t, "invalid_body", e.do("POST", "/api/v1/auth/login", "", strings.Repeat("a", 2<<20)).errCode(), "too large")
}

func TestOrganizationsLinksAndRedirect(t *testing.T) {
	e := newEnv(t, false)
	token := e.signUp("ana@example.com", "Ana")
	orgID := e.createOrg(token, "Acme")

	res := e.do("POST", "/api/v1/orgs", token, map[string]string{"name": "Acme"})
	assert.Equal(t, http.StatusConflict, res.status)

	list := e.do("GET", "/api/v1/orgs", token, nil)
	require.Equal(t, 200, list.status)
	assert.Contains(t, list.raw, `"Acme"`)

	res = e.do("POST", "/api/v1/orgs/"+orgID+"/links", token, map[string]string{"url": "https://example.com/a?b=1"})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	code := res.str("code")
	assert.Len(t, code, 7)
	assert.Equal(t, "http://short.test/"+code, res.str("short_url"))

	redirect := e.do("GET", "/"+code, "", nil)
	assert.Equal(t, http.StatusFound, redirect.status, "302, not 301, so every click is counted")
	assert.Equal(t, "https://example.com/a?b=1", redirect.header.Get("Location"))

	assert.Equal(t, http.StatusNotFound, e.do("GET", "/nope123", "", nil).status)
	res = e.do("POST", "/api/v1/orgs/"+orgID+"/links", token, map[string]string{"url": "ftp://example.com"})
	assert.Equal(t, "invalid_url", res.errCode())

	res = e.do("POST", "/api/v1/orgs/"+orgID+"/links", token, map[string]any{"url": "https://example.com/old", "expires_at": "2020-01-01T00:00:00Z"})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	assert.Equal(t, http.StatusGone, e.do("GET", "/"+res.str("code"), "", nil).status, "expired links answer 410")
}

func TestTenantsAreIsolated(t *testing.T) {
	e := newEnv(t, false)
	ana := e.signUp("ana@example.com", "Ana")
	bob := e.signUp("bob@example.com", "Bob")
	acme := e.createOrg(ana, "Acme")

	for name, res := range map[string]response{
		"read org":      e.do("GET", "/api/v1/orgs/"+acme, bob, nil),
		"list members":  e.do("GET", "/api/v1/orgs/"+acme+"/members", bob, nil),
		"create link":   e.do("POST", "/api/v1/orgs/"+acme+"/links", bob, map[string]string{"url": "https://example.com"}),
		"create key":    e.do("POST", "/api/v1/orgs/"+acme+"/api-keys", bob, map[string]string{"name": "x"}),
		"list keys":     e.do("GET", "/api/v1/orgs/"+acme+"/api-keys", bob, nil),
		"invite":        e.do("POST", "/api/v1/orgs/"+acme+"/invitations", bob, map[string]string{"email": "c@example.com"}),
		"list invites":  e.do("GET", "/api/v1/orgs/"+acme+"/invitations", bob, nil),
		"remove member": e.do("DELETE", "/api/v1/orgs/"+acme+"/members/1", bob, nil),
	} {
		assert.Equal(t, http.StatusForbidden, res.status, name)
		assert.Equal(t, "not_member", res.errCode(), name)
	}
	assert.Equal(t, http.StatusNotFound, e.do("GET", "/api/v1/orgs/abc", ana, nil).status)
}

func TestAPIKeys(t *testing.T) {
	e := newEnv(t, false)
	ana := e.signUp("ana@example.com", "Ana")
	acme := e.createOrg(ana, "Acme")
	other := e.createOrg(ana, "Other")

	res := e.do("POST", "/api/v1/orgs/"+acme+"/api-keys", ana, map[string]string{"name": "ci"})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	secret, keyID := res.str("secret"), res.id()
	assert.True(t, strings.HasPrefix(secret, "usl_"))

	listed := e.do("GET", "/api/v1/orgs/"+acme+"/api-keys", ana, nil)
	assert.Contains(t, listed.raw, `"ci"`)
	assert.NotContains(t, listed.raw, secret, "the secret is shown once")
	assert.NotContains(t, listed.raw, "secret")

	// The key creates links in its own organization only.
	res = e.do("POST", "/api/v1/orgs/"+acme+"/links", secret, map[string]string{"url": "https://example.com/k"})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	res = e.do("POST", "/api/v1/orgs/"+other+"/links", secret, map[string]string{"url": "https://example.com/k"})
	assert.Equal(t, http.StatusForbidden, res.status)

	// Keys cannot manage accounts, organizations or other keys.
	for _, p := range []string{"/api/v1/me", "/api/v1/orgs", "/api/v1/orgs/" + acme + "/api-keys"} {
		assert.Equal(t, "api_key_not_allowed", e.do("GET", p, secret, nil).errCode(), p)
	}
	assert.Equal(t, http.StatusUnauthorized, e.do("POST", "/api/v1/orgs/"+acme+"/links", "usl_wrong", map[string]string{"url": "https://example.com"}).status)

	require.Equal(t, http.StatusNoContent, e.do("DELETE", "/api/v1/orgs/"+acme+"/api-keys/"+keyID, ana, nil).status)
	assert.Equal(t, http.StatusUnauthorized, e.do("POST", "/api/v1/orgs/"+acme+"/links", secret, map[string]string{"url": "https://example.com"}).status, "deleted keys stop working")
	assert.Equal(t, http.StatusNotFound, e.do("DELETE", "/api/v1/orgs/"+acme+"/api-keys/"+keyID, ana, nil).status)
}

func TestInvitationsMembersAndRemoval(t *testing.T) {
	e := newEnv(t, false)
	ana := e.signUp("ana@example.com", "Ana")
	bob := e.signUp("bob@example.com", "Bob")
	acme := e.createOrg(ana, "Acme")

	res := e.do("POST", "/api/v1/orgs/"+acme+"/invitations", ana, map[string]any{
		"email": "bob@example.com", "cc": []string{"boss@example.com"}, "bcc": []string{"audit@example.com"},
	})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	invID := res.id()
	assert.Equal(t, "PENDING", res.str("status"))

	var invite mailing.Message
	for _, m := range e.emails() {
		if strings.Contains(m.Subject, "invited you") {
			invite = m
		}
	}
	assert.Equal(t, "bob@example.com", invite.To)
	assert.Equal(t, []string{"boss@example.com"}, invite.CC)
	assert.Equal(t, []string{"audit@example.com"}, invite.BCC)
	assert.Contains(t, invite.Subject, "Ana Tester")

	assert.Equal(t, "invitation_exists", e.do("POST", "/api/v1/orgs/"+acme+"/invitations", ana, map[string]string{"email": "bob@example.com"}).errCode())
	assert.Equal(t, "invalid_email", e.do("POST", "/api/v1/orgs/"+acme+"/invitations", ana, map[string]any{"email": "c@example.com", "cc": []string{"nope"}}).errCode())

	// Only the invited email can answer it.
	carl := e.signUp("carl@example.com", "Carl")
	assert.Equal(t, http.StatusNotFound, e.do("POST", "/api/v1/invitations/"+invID+"/accept", carl, nil).status)

	pending := e.do("GET", "/api/v1/orgs/"+acme+"/invitations", ana, nil)
	assert.Contains(t, pending.raw, "bob@example.com")

	// Bob cannot use the organization until he accepts.
	assert.Equal(t, http.StatusForbidden, e.do("POST", "/api/v1/orgs/"+acme+"/links", bob, map[string]string{"url": "https://example.com"}).status)
	res = e.do("POST", "/api/v1/invitations/"+invID+"/accept", bob, nil)
	require.Equal(t, http.StatusOK, res.status, res.raw)
	assert.Equal(t, "ADMIN", res.str("role"))
	assert.Equal(t, http.StatusCreated, e.do("POST", "/api/v1/orgs/"+acme+"/links", bob, map[string]string{"url": "https://example.com"}).status)
	assert.Equal(t, "invitation_not_pending", e.do("POST", "/api/v1/invitations/"+invID+"/accept", bob, nil).errCode())

	members := e.do("GET", "/api/v1/orgs/"+acme+"/members", ana, nil)
	require.Equal(t, 200, members.status)
	assert.Equal(t, 2, strings.Count(members.raw, `"role"`))

	// The owner cannot be removed; an admin can.
	bobMe := e.do("GET", "/api/v1/me", bob, nil)
	anaMe := e.do("GET", "/api/v1/me", ana, nil)
	assert.Equal(t, "cannot_remove_owner", e.do("DELETE", "/api/v1/orgs/"+acme+"/members/"+anaMe.id(), bob, nil).errCode())
	require.Equal(t, http.StatusNoContent, e.do("DELETE", "/api/v1/orgs/"+acme+"/members/"+bobMe.id(), ana, nil).status)
	assert.Equal(t, http.StatusForbidden, e.do("POST", "/api/v1/orgs/"+acme+"/links", bob, map[string]string{"url": "https://example.com"}).status, "removed members lose access")

	// A rejected invitation stays rejected.
	res = e.do("POST", "/api/v1/orgs/"+acme+"/invitations", ana, map[string]string{"email": "carl@example.com"})
	require.Equal(t, http.StatusCreated, res.status)
	require.Equal(t, http.StatusNoContent, e.do("POST", "/api/v1/invitations/"+res.id()+"/reject", carl, nil).status)
	assert.Equal(t, "invitation_not_pending", e.do("POST", "/api/v1/invitations/"+res.id()+"/accept", carl, nil).errCode())
}

func TestPasswordReset(t *testing.T) {
	e := newEnv(t, false)
	e.signUp("ana@example.com", "Ana")

	// The answer is the same for unknown emails, and no code is sent to them.
	before := len(e.emails())
	res := e.do("POST", "/api/v1/auth/forgot-password", "", map[string]string{"email": "nobody@example.com"})
	assert.Equal(t, http.StatusAccepted, res.status)
	assert.Len(t, e.emails(), before)

	require.Equal(t, http.StatusAccepted, e.do("POST", "/api/v1/auth/forgot-password", "", map[string]string{"email": "ana@example.com"}).status)
	code := e.lastCode("ana@example.com")

	res = e.do("POST", "/api/v1/auth/reset-password", "", map[string]string{"email": "ana@example.com", "code": code, "new_password": "short"})
	assert.Equal(t, "weak_password", res.errCode())
	res = e.do("POST", "/api/v1/auth/reset-password", "", map[string]string{"email": "ana@example.com", "code": code, "new_password": "brand-new-pass"})
	require.Equal(t, http.StatusNoContent, res.status, res.raw)

	assert.Equal(t, http.StatusUnauthorized, e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "ana@example.com", "password": "s3cretpass"}).status)
	assert.Equal(t, http.StatusOK, e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "ana@example.com", "password": "brand-new-pass"}).status)
	assert.Equal(t, "invalid_code", e.do("POST", "/api/v1/auth/reset-password", "", map[string]string{"email": "ana@example.com", "code": code, "new_password": "another-pass-1"}).errCode(), "single use")
}

func TestGoogleSignIn(t *testing.T) {
	e := newEnv(t, true)
	res := e.do("POST", "/api/v1/auth/google", "", map[string]string{"id_token": "bad"})
	assert.Equal(t, http.StatusUnauthorized, res.status)

	res = e.do("POST", "/api/v1/auth/google", "", map[string]string{"id_token": "good-token"})
	require.Equal(t, http.StatusOK, res.status, res.raw)
	token := res.str("token")
	assert.Equal(t, "gina@example.com", e.do("GET", "/api/v1/me", token, nil).str("email"))
	again := e.do("POST", "/api/v1/auth/google", "", map[string]string{"id_token": "good-token"})
	assert.Equal(t, http.StatusOK, again.status)

	// The address now belongs to the Google account only.
	res = e.do("POST", "/api/v1/auth/register", "", map[string]string{"email": "gina@example.com", "password": "s3cretpass", "first_name": "G", "last_name": "G"})
	assert.Equal(t, "email_taken", res.errCode())
	res = e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "gina@example.com", "password": "anything-at-all"})
	assert.Equal(t, http.StatusUnauthorized, res.status)
}

func TestGoogleSignInMismatchWithPasswordAccount(t *testing.T) {
	e := newEnv(t, true)
	e.signUp("gina@example.com", "Gina")
	res := e.do("POST", "/api/v1/auth/google", "", map[string]string{"id_token": "good-token"})
	assert.Equal(t, http.StatusConflict, res.status)
	assert.Equal(t, "provider_mismatch", res.errCode())
}

func TestGoogleRouteIsAbsentWhenNotConfigured(t *testing.T) {
	e := newEnv(t, false)
	assert.Equal(t, http.StatusNotFound, e.do("POST", "/api/v1/auth/google", "", map[string]string{"id_token": "x"}).status)
}

func TestEveryEmailIsLoggedWithTheProviderID(t *testing.T) {
	e := newEnv(t, false)
	e.signUp("ana@example.com", "Ana") // verify-email code + welcome
	sent := e.emails()
	require.NotEmpty(t, sent)

	rows, err := e.sql.QueryContext(context.Background(),
		`SELECT t.code, l.to_email, l.status, l.email_provider, l.email_provider_id FROM email_logs l JOIN email_templates t ON t.id = l.template_id`)
	require.NoError(t, err)
	defer rows.Close()
	var codes []string
	for rows.Next() {
		var code, to, status, provider, providerID string
		require.NoError(t, rows.Scan(&code, &to, &status, &provider, &providerID))
		assert.Equal(t, "ana@example.com", to)
		assert.Equal(t, "SENT", status)
		assert.Equal(t, "TEST", provider)
		assert.NotEmpty(t, providerID)
		codes = append(codes, code)
	}
	require.NoError(t, rows.Err())
	assert.ElementsMatch(t, []string{"VERIFY_EMAIL", "WELCOME"}, codes)
	assert.Len(t, codes, len(sent))
}
