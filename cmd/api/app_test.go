package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/repository/cached"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/config"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
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

type fakeGoogle struct{ id *user.GoogleIdentity }

func (f fakeGoogle) Exchange(_ context.Context, code string) (user.GoogleIdentity, error) {
	if code != "good-code" {
		return user.GoogleIdentity{}, auth.ErrInvalidCredentials
	}
	return *f.id, nil
}

var googleIdentity = user.GoogleIdentity{
	Subject: "g-1", Email: "gina@example.com", EmailVerified: true, FirstName: "Gina", LastName: "Google",
	Scope: "openid email profile",
}

type env struct {
	t      *testing.T
	app    *app
	outbox *outbox
	sql    *sql.DB
}

func newEnv(t *testing.T, withGoogle bool) *env {
	t.Helper()
	return newEnvWithCache(t, withGoogle, nil)
}

func newEnvWithCache(t *testing.T, withGoogle bool, linkCache cached.Store) *env {
	t.Helper()
	return newEnvFull(t, withGoogle, linkCache, nil, false)
}

// fakeCountries places every address in a fixed country.
type fakeCountries map[string]string

func (f fakeCountries) Country(ip netip.Addr) string { return f[ip.String()] }

func newEnvFull(t *testing.T, withGoogle bool, linkCache cached.Store, countries analytics.CountryResolver, trustProxy bool) *env {
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

		linkCache: linkCache,
		countries: countries,
	}
	if withGoogle {
		a.google = fakeGoogle{&googleIdentity}
	}
	cfg := &config.Config{
		AppURL:     "http://short.test",
		JWTSecret:  "0123456789abcdef0123456789abcdef",
		JWTTTL:     time.Hour,
		OTPSecret:  "fedcba9876543210fedcba9876543210",
		RefreshTTL: 24 * time.Hour,

		LinkCacheTTL: time.Minute,
		TrustProxy:   trustProxy,
	}
	e := &env{t: t, app: newApp(cfg, db.DB, a), outbox: box, sql: db.DB}
	t.Cleanup(e.app.mail.Wait)
	// Registered after the database cleanup, so queued clicks are written before it closes.
	t.Cleanup(func() { _ = e.app.clicks.Close(context.Background()) })
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
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.app.handler.ServeHTTP(rec, req)
	res := response{status: rec.Code, header: rec.Header(), raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &res.body)
	// Successes come as {"data": ...}: expose the payload so tests read fields directly.
	// Errors keep the full envelope, so errCode can read {"error": {...}}.
	if data, ok := res.body["data"].(map[string]any); ok {
		res.body = data
	}
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
	login := func(body string) response { return e.do("POST", "/api/v1/auth/login", "", body) }

	res := login(`{"email":"a@b.co","password":"x","extra":1}`)
	assert.Equal(t, http.StatusBadRequest, res.status)
	assert.Equal(t, "unknown_field", res.errCode(), "unknown field")
	assert.Contains(t, res.raw, `"field":"extra"`)

	res = login(`not json`)
	assert.Equal(t, http.StatusBadRequest, res.status)
	assert.Equal(t, "malformed_json", res.errCode())

	assert.Equal(t, "empty_body", login(``).errCode())
	assert.Equal(t, "invalid_body", login(`{"email":"a@b.co"} {"x":1}`).errCode(), "two values")

	res = login(`{"email":5}`)
	assert.Equal(t, "invalid_field_type", res.errCode())
	assert.Contains(t, res.raw, `"field":"email"`)

	res = login(`{"email":"` + strings.Repeat("a", 2<<20) + `"}`)
	assert.Equal(t, http.StatusRequestEntityTooLarge, res.status)
	assert.Equal(t, "body_too_large", res.errCode())
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
	assert.Equal(t, http.StatusBadRequest, res.status)
	assert.Equal(t, "invalid_expiry", res.errCode(), "an expiration must be in the future")

	res = e.do("POST", "/api/v1/orgs/"+orgID+"/links", token, map[string]any{"url": "https://example.com/once", "max_clicks": 0})
	assert.Equal(t, "invalid_max_clicks", res.errCode())

	res = e.do("POST", "/api/v1/orgs/"+orgID+"/links", token, map[string]any{"url": "https://example.com/once", "max_clicks": 1})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	once := res.str("code")
	assert.Equal(t, http.StatusFound, e.do("GET", "/"+once, "", nil).status)
	assert.Equal(t, http.StatusGone, e.do("GET", "/"+once, "", nil).status, "a link out of clicks answers 410")
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
		"create key":    e.do("POST", "/api/v1/orgs/"+acme+"/api-keys", bob, map[string]string{"name": "x", "scope": "read"}),
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

	res := e.do("POST", "/api/v1/orgs/"+acme+"/api-keys", ana, map[string]string{"name": "ci", "scope": "write"})
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

// memLinkCache is an in-memory cached.Store.
type memLinkCache struct {
	mu   sync.Mutex
	data map[string][]byte
}

func (c *memLinkCache) Get(_ context.Context, key string) ([]byte, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.data[key]
	return v, ok, nil
}

func (c *memLinkCache) Set(_ context.Context, key string, value []byte, _ time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.data[key] = value
	return nil
}

func (c *memLinkCache) Del(_ context.Context, keys ...string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, k := range keys {
		delete(c.data, k)
	}
	return nil
}

func TestRedirectsAreServedFromTheLinkCache(t *testing.T) {
	cache := &memLinkCache{data: map[string][]byte{}}
	e := newEnvWithCache(t, false, cache)
	ana := e.signUp("ana@example.com", "Ana")
	acme := e.createOrg(ana, "Acme")
	links := "/api/v1/orgs/" + acme + "/links"

	res := e.do("POST", links, ana, map[string]string{"url": "https://example.com/cached"})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	code := res.str("code")
	assert.Empty(t, cache.data, "nothing is cached until the first redirect")

	require.Equal(t, http.StatusFound, e.do("GET", "/"+code, "", nil).status)
	assert.Contains(t, cache.data, "link:code:"+code)

	// Removing the row behind the app's back proves the second redirect comes from the cache.
	_, err := e.sql.ExecContext(context.Background(), `DELETE FROM links WHERE code = ?`, code)
	require.NoError(t, err)
	cachedRes := e.do("GET", "/"+code, "", nil)
	assert.Equal(t, http.StatusFound, cachedRes.status)
	assert.Equal(t, "https://example.com/cached", cachedRes.header.Get("Location"))

	// Deleting through the API drops the entry.
	res = e.do("POST", links, ana, map[string]string{"url": "https://example.com/two", "alias": "second"})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	require.Equal(t, http.StatusFound, e.do("GET", "/second", "", nil).status)
	require.Contains(t, cache.data, "link:code:second")
	require.Equal(t, http.StatusNoContent, e.do("DELETE", links+"/"+res.id(), ana, nil).status)
	assert.NotContains(t, cache.data, "link:code:second")
	assert.Equal(t, http.StatusNotFound, e.do("GET", "/second", "", nil).status)
}

func TestCachedLinksStillStopAtMaxClicks(t *testing.T) {
	e := newEnvWithCache(t, false, &memLinkCache{data: map[string][]byte{}})
	ana := e.signUp("ana@example.com", "Ana")
	acme := e.createOrg(ana, "Acme")
	res := e.do("POST", "/api/v1/orgs/"+acme+"/links", ana, map[string]any{"url": "https://example.com/two", "max_clicks": 2})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	code := res.str("code")

	assert.Equal(t, http.StatusFound, e.do("GET", "/"+code, "", nil).status)
	assert.Equal(t, http.StatusFound, e.do("GET", "/"+code, "", nil).status)
	assert.Equal(t, http.StatusGone, e.do("GET", "/"+code, "", nil).status, "the database counter ends it, the cached copy is not trusted for that")
}

func TestRedirectsAreRecordedAsClicks(t *testing.T) {
	e := newEnv(t, false)
	ana := e.signUp("ana@example.com", "Ana")
	acme := e.createOrg(ana, "Acme")
	links := "/api/v1/orgs/" + acme + "/links"
	res := e.do("POST", links, ana, map[string]string{"url": "https://example.com/c", "alias": "tracked-1"})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	linkID := res.id()

	visit := func(code, referer, ua string) int {
		req := httptest.NewRequest(http.MethodGet, "/"+code, nil)
		req.Header.Set("Referer", referer)
		req.Header.Set("User-Agent", ua)
		rec := httptest.NewRecorder()
		e.app.handler.ServeHTTP(rec, req)
		return rec.Code
	}
	require.Equal(t, http.StatusFound, visit("tracked-1", "https://news.example/a", "Mozilla/5.0"))
	require.Equal(t, http.StatusFound, visit("tracked-1", "", "curl/8"))
	require.Equal(t, http.StatusNotFound, visit("missing", "", "curl/8"))

	// Close waits for the background writer, so the log is complete after it.
	require.NoError(t, e.app.clicks.Close(context.Background()))
	rows, err := e.sql.QueryContext(context.Background(), `SELECT link_id, referrer, user_agent, clicked_at FROM clicks ORDER BY id`)
	require.NoError(t, err)
	defer rows.Close()
	type click struct{ link, referrer, ua, at string }
	var got []click
	for rows.Next() {
		var c click
		require.NoError(t, rows.Scan(&c.link, &c.referrer, &c.ua, &c.at))
		got = append(got, c)
	}
	require.Len(t, got, 2, "only the two redirects that worked")
	assert.Equal(t, linkID, got[0].link)
	assert.Equal(t, "https://news.example/a", got[0].referrer)
	assert.Equal(t, "Mozilla/5.0", got[0].ua)
	assert.True(t, strings.HasSuffix(got[0].at, "Z"), "stored in UTC")
	assert.Equal(t, "curl/8", got[1].ua)

	// Deleting the link removes its clicks.
	e2 := newEnv(t, false)
	ana2 := e2.signUp("ana@example.com", "Ana")
	org2 := e2.createOrg(ana2, "Acme")
	l2 := e2.do("POST", "/api/v1/orgs/"+org2+"/links", ana2, map[string]string{"url": "https://example.com/d", "alias": "gone-soon"})
	require.Equal(t, http.StatusCreated, l2.status)
	require.Equal(t, http.StatusFound, e2.do("GET", "/gone-soon", "", nil).status)
	require.NoError(t, e2.app.clicks.Close(context.Background()))
	var n int
	require.NoError(t, e2.sql.QueryRowContext(context.Background(), `SELECT count(*) FROM clicks`).Scan(&n))
	require.Equal(t, 1, n)
	require.Equal(t, http.StatusNoContent, e2.do("DELETE", "/api/v1/orgs/"+org2+"/links/"+l2.id(), ana2, nil).status)
	require.NoError(t, e2.sql.QueryRowContext(context.Background(), `SELECT count(*) FROM clicks`).Scan(&n))
	assert.Zero(t, n, "clicks are deleted with their link")
}

func TestClicksAreEnrichedAndReportedAsStats(t *testing.T) {
	e := newEnvFull(t, false, nil, fakeCountries{"203.0.113.7": "PE", "198.51.100.9": "US"}, true)
	ana := e.signUp("ana@example.com", "Ana")
	bob := e.signUp("bob@example.com", "Bob")
	acme := e.createOrg(ana, "Acme")
	bobOrg := e.createOrg(bob, "Bobs")
	res := e.do("POST", "/api/v1/orgs/"+acme+"/links", ana, map[string]string{"url": "https://example.com/s", "alias": "stats-01"})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	linkID := res.id()
	stats := "/api/v1/orgs/" + acme + "/links/" + linkID + "/stats"

	visit := func(remote, forwarded, referer, ua string) {
		req := httptest.NewRequest(http.MethodGet, "/stats-01", nil)
		req.RemoteAddr = remote
		if forwarded != "" {
			req.Header.Set("X-Forwarded-For", forwarded)
		}
		req.Header.Set("Referer", referer)
		req.Header.Set("User-Agent", ua)
		rec := httptest.NewRecorder()
		e.app.handler.ServeHTTP(rec, req)
		require.Equal(t, http.StatusFound, rec.Code)
	}
	iphone := "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1"
	desktop := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36"
	visit("10.0.0.2:80", "203.0.113.7, 10.0.0.2", "https://news.example/a", iphone) // behind the proxy
	visit("10.0.0.2:80", "203.0.113.7", "https://news.example/a", iphone)
	visit("198.51.100.9:5000", "", "", desktop) // no forwarded header: the remote address is used
	require.NoError(t, e.app.clicks.Close(context.Background()))

	var country, device string
	require.NoError(t, e.sql.QueryRowContext(context.Background(), `SELECT country, device FROM clicks ORDER BY id LIMIT 1`).Scan(&country, &device))
	assert.Equal(t, []string{"PE", "mobile"}, []string{country, device})

	res = e.do("GET", stats, ana, nil)
	require.Equal(t, http.StatusOK, res.status, res.raw)
	assert.EqualValues(t, 3, res.body["total"])
	assert.Len(t, res.body["daily"], analytics.DefaultDays)
	today := res.body["daily"].([]any)[analytics.DefaultDays-1].(map[string]any)
	assert.EqualValues(t, 3, today["clicks"], "the last day of the default window is today")
	assert.Equal(t, []any{map[string]any{"name": "PE", "clicks": float64(2)}, map[string]any{"name": "US", "clicks": float64(1)}}, res.body["countries"])
	assert.Equal(t, []any{map[string]any{"name": "mobile", "clicks": float64(2)}, map[string]any{"name": "desktop", "clicks": float64(1)}}, res.body["devices"])
	assert.Equal(t, []any{map[string]any{"name": "https://news.example/a", "clicks": float64(2)}, map[string]any{"name": "direct", "clicks": float64(1)}}, res.body["referrers"])

	t.Run("a window without clicks is all zeros", func(t *testing.T) {
		res := e.do("GET", stats+"?from=2020-01-01&to=2020-01-03", ana, nil)
		require.Equal(t, http.StatusOK, res.status, res.raw)
		assert.EqualValues(t, 0, res.body["total"])
		assert.Len(t, res.body["daily"], 3)
		assert.Equal(t, []any{}, res.body["referrers"])
	})

	t.Run("bad ranges are 400", func(t *testing.T) {
		for _, q := range []string{"from=yesterday", "to=2026-13-40", "from=2026-03-05&to=2026-03-01", "from=2020-01-01&to=2026-01-01"} {
			res := e.do("GET", stats+"?"+q, ana, nil)
			assert.Equal(t, http.StatusBadRequest, res.status, q)
			assert.Equal(t, "invalid_range", res.errCode(), q)
		}
	})

	t.Run("only the owner organization sees them", func(t *testing.T) {
		assert.Equal(t, "not_member", e.do("GET", stats, bob, nil).errCode())
		// Bob's own organization, but Ana's link id: it does not exist there.
		res := e.do("GET", "/api/v1/orgs/"+bobOrg+"/links/"+linkID+"/stats", bob, nil)
		assert.Equal(t, http.StatusNotFound, res.status)
		assert.Equal(t, http.StatusNotFound, e.do("GET", "/api/v1/orgs/"+acme+"/links/99999/stats", ana, nil).status)
		assert.Equal(t, http.StatusNotFound, e.do("GET", "/api/v1/orgs/"+acme+"/links/abc/stats", ana, nil).status)
	})

	t.Run("an API key needs only the read scope", func(t *testing.T) {
		secret := e.do("POST", "/api/v1/orgs/"+acme+"/api-keys", ana, map[string]string{"name": "r", "scope": "read"}).str("secret")
		assert.Equal(t, http.StatusOK, e.do("GET", stats, secret, nil).status)
	})
}

func TestListAndDeleteLinks(t *testing.T) {
	e := newEnv(t, false)
	ana := e.signUp("ana@example.com", "Ana")
	bob := e.signUp("bob@example.com", "Bob")
	acme := e.createOrg(ana, "Acme")
	bobOrg := e.createOrg(bob, "Bobs")
	links := "/api/v1/orgs/" + acme + "/links"

	var ids []string
	for _, u := range []string{"a", "b", "c"} {
		res := e.do("POST", links, ana, map[string]string{"url": "https://example.com/" + u})
		require.Equal(t, http.StatusCreated, res.status, res.raw)
		ids = append(ids, res.id())
	}
	foreign := e.do("POST", "/api/v1/orgs/"+bobOrg+"/links", bob, map[string]string{"url": "https://example.com/bob"})
	require.Equal(t, http.StatusCreated, foreign.status)

	t.Run("lists the newest first with the window and the total", func(t *testing.T) {
		res := e.do("GET", links+"?limit=2", ana, nil)
		require.Equal(t, http.StatusOK, res.status, res.raw)
		data := res.body["data"].([]any)
		require.Len(t, data, 2)
		assert.Equal(t, ids[2], strconv.FormatInt(int64(data[0].(map[string]any)["id"].(float64)), 10))
		assert.Equal(t, map[string]any{"limit": float64(2), "offset": float64(0), "total": float64(3)}, res.body["meta"])

		res = e.do("GET", links+"?limit=2&offset=2", ana, nil)
		assert.Len(t, res.body["data"].([]any), 1)
	})

	t.Run("an empty list is [] and not null", func(t *testing.T) {
		res := e.do("GET", links+"?offset=50", ana, nil)
		assert.Equal(t, http.StatusOK, res.status)
		assert.Contains(t, res.raw, `"data":[]`)
	})

	t.Run("bad pagination is a 400", func(t *testing.T) {
		for _, q := range []string{"limit=0", "limit=x", "offset=-1"} {
			res := e.do("GET", links+"?"+q, ana, nil)
			assert.Equal(t, http.StatusBadRequest, res.status, q)
			assert.Equal(t, "invalid_pagination", res.errCode(), q)
		}
	})

	t.Run("another organization cannot list or delete", func(t *testing.T) {
		assert.Equal(t, "not_member", e.do("GET", links, bob, nil).errCode())
		assert.Equal(t, "not_member", e.do("DELETE", links+"/"+ids[0], bob, nil).errCode())
		// An id of another organization, asked through my own organization, is just not found.
		assert.Equal(t, http.StatusNotFound, e.do("DELETE", links+"/"+foreign.id(), ana, nil).status)
		assert.Equal(t, http.StatusFound, e.do("GET", "/"+foreign.str("code"), "", nil).status, "it was not deleted")
	})

	t.Run("API key scopes: read lists, only write deletes", func(t *testing.T) {
		keys := "/api/v1/orgs/" + acme + "/api-keys"
		readKey := e.do("POST", keys, ana, map[string]string{"name": "r", "scope": "read"}).str("secret")
		writeKey := e.do("POST", keys, ana, map[string]string{"name": "w", "scope": "write"}).str("secret")
		assert.Equal(t, http.StatusOK, e.do("GET", links, readKey, nil).status)
		res := e.do("DELETE", links+"/"+ids[0], readKey, nil)
		assert.Equal(t, http.StatusForbidden, res.status)
		assert.Equal(t, "insufficient_scope", res.errCode())
		assert.Equal(t, http.StatusNoContent, e.do("DELETE", links+"/"+ids[0], writeKey, nil).status)
	})

	t.Run("deleting removes the link everywhere", func(t *testing.T) {
		code := e.do("GET", links+"?limit=1", ana, nil).body["data"].([]any)[0].(map[string]any)["code"].(string)
		require.Equal(t, http.StatusFound, e.do("GET", "/"+code, "", nil).status)
		require.Equal(t, http.StatusNoContent, e.do("DELETE", links+"/"+ids[2], ana, nil).status)
		assert.Equal(t, http.StatusNotFound, e.do("GET", "/"+code, "", nil).status)
		assert.Equal(t, http.StatusNotFound, e.do("DELETE", links+"/"+ids[2], ana, nil).status)
		assert.Equal(t, http.StatusNotFound, e.do("DELETE", links+"/abc", ana, nil).status)
		assert.Equal(t, float64(1), e.do("GET", links, ana, nil).body["meta"].(map[string]any)["total"])
	})
}

func TestListAPIKeysIsPaginated(t *testing.T) {
	e := newEnv(t, false)
	ana := e.signUp("ana@example.com", "Ana")
	acme := e.createOrg(ana, "Acme")
	keys := "/api/v1/orgs/" + acme + "/api-keys"
	for _, n := range []string{"one", "two", "three"} {
		require.Equal(t, http.StatusCreated, e.do("POST", keys, ana, map[string]string{"name": n, "scope": "read"}).status)
	}
	res := e.do("GET", keys+"?limit=2&offset=1", ana, nil)
	require.Equal(t, http.StatusOK, res.status, res.raw)
	data := res.body["data"].([]any)
	require.Len(t, data, 2)
	assert.Equal(t, "two", data[0].(map[string]any)["name"])
	assert.Equal(t, map[string]any{"limit": float64(2), "offset": float64(1), "total": float64(3)}, res.body["meta"])
	assert.Equal(t, "invalid_pagination", e.do("GET", keys+"?limit=0", ana, nil).errCode())
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
	res := e.do("POST", "/api/v1/auth/google", "", map[string]string{"code": "bad"})
	assert.Equal(t, http.StatusUnauthorized, res.status)

	res = e.do("POST", "/api/v1/auth/google", "", map[string]string{"code": "good-code"})
	require.Equal(t, http.StatusOK, res.status, res.raw)
	token := res.str("token")
	assert.NotEmpty(t, res.str("refresh_token"))
	assert.Equal(t, "gina@example.com", e.do("GET", "/api/v1/me", token, nil).str("email"))
	assert.Equal(t, http.StatusOK, e.do("POST", "/api/v1/auth/google", "", map[string]string{"code": "good-code"}).status)

	// The scope Google reported is saved on the account and follows later sign-ins.
	scope := func() (string, bool) {
		var s string
		var updated sql.NullString
		require.NoError(t, e.sql.QueryRowContext(context.Background(),
			`SELECT scope, updated_at FROM accounts WHERE provider_id = 'GOOGLE'`).Scan(&s, &updated))
		return s, updated.Valid
	}
	s, touched := scope()
	assert.Equal(t, "openid email profile", s)
	assert.False(t, touched)
	googleIdentity.Scope = "openid email profile https://www.googleapis.com/auth/calendar.readonly"
	t.Cleanup(func() { googleIdentity.Scope = "openid email profile" })
	require.Equal(t, http.StatusOK, e.do("POST", "/api/v1/auth/google", "", map[string]string{"code": "good-code"}).status)
	s, touched = scope()
	assert.Contains(t, s, "calendar.readonly")
	assert.True(t, touched, "updated_at is stamped when the scope changes")

	// The address now belongs to the Google account only.
	res = e.do("POST", "/api/v1/auth/register", "", map[string]string{"email": "gina@example.com", "password": "s3cretpass", "first_name": "G", "last_name": "G"})
	assert.Equal(t, "email_taken", res.errCode())
	res = e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "gina@example.com", "password": "anything-at-all"})
	assert.Equal(t, http.StatusUnauthorized, res.status)
}

func TestGoogleSignInMismatchWithPasswordAccount(t *testing.T) {
	e := newEnv(t, true)
	e.signUp("gina@example.com", "Gina")
	res := e.do("POST", "/api/v1/auth/google", "", map[string]string{"code": "good-code"})
	assert.Equal(t, http.StatusConflict, res.status)
	assert.Equal(t, "provider_mismatch", res.errCode())
}

func TestGoogleRouteIsAbsentWhenNotConfigured(t *testing.T) {
	e := newEnv(t, false)
	assert.Equal(t, http.StatusNotFound, e.do("POST", "/api/v1/auth/google", "", map[string]string{"code": "x"}).status)
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

func TestRefreshTokens(t *testing.T) {
	e := newEnv(t, false)
	e.signUp("ana@example.com", "Ana")

	login := e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "ana@example.com", "password": "s3cretpass"})
	require.Equal(t, http.StatusOK, login.status)
	assert.Equal(t, "no-store", login.header.Get("Cache-Control"))
	refresh := login.str("refresh_token")
	assert.True(t, strings.HasPrefix(refresh, "rft_"))
	assert.True(t, strings.HasSuffix(login.str("refresh_expires_at"), "Z"), "times are UTC")
	assert.True(t, strings.HasSuffix(login.str("expires_at"), "Z"))

	// A refresh returns a working access token and a replacement refresh token.
	res := e.do("POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": refresh})
	require.Equal(t, http.StatusOK, res.status, res.raw)
	assert.Equal(t, http.StatusOK, e.do("GET", "/api/v1/me", res.str("token"), nil).status)
	next := res.str("refresh_token")
	assert.NotEqual(t, refresh, next)

	// Replaying the old one is theft: it fails and every session of the user dies.
	res = e.do("POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": refresh})
	assert.Equal(t, http.StatusUnauthorized, res.status)
	assert.Equal(t, "invalid_credentials", res.errCode())
	assert.Equal(t, http.StatusUnauthorized, e.do("POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": next}).status)

	assert.Equal(t, http.StatusUnauthorized, e.do("POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": "rft_nope"}).status)
	assert.Equal(t, http.StatusUnauthorized, e.do("POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": ""}).status)
}

func TestLogoutRevokesTheRefreshToken(t *testing.T) {
	e := newEnv(t, false)
	e.signUp("ana@example.com", "Ana")
	login := e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "ana@example.com", "password": "s3cretpass"})
	refresh := login.str("refresh_token")

	assert.Equal(t, http.StatusNoContent, e.do("POST", "/api/v1/auth/logout", "", map[string]string{"refresh_token": refresh}).status)
	assert.Equal(t, http.StatusUnauthorized, e.do("POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": refresh}).status)
	assert.Equal(t, http.StatusNoContent, e.do("POST", "/api/v1/auth/logout", "", map[string]string{"refresh_token": "rft_unknown"}).status)
}

func TestSignupAndPasswordResetEndSessions(t *testing.T) {
	e := newEnv(t, false)
	signup := e.do("POST", "/api/v1/auth/register", "", map[string]string{"email": "ana@example.com", "password": "s3cretpass", "first_name": "A", "last_name": "B"})
	require.Equal(t, http.StatusAccepted, signup.status)
	verified := e.do("POST", "/api/v1/auth/register/verify", "", map[string]string{"email": "ana@example.com", "code": e.lastCode("ana@example.com")})
	require.Equal(t, http.StatusCreated, verified.status)
	stolen := verified.str("refresh_token")
	assert.NotEmpty(t, stolen, "signup opens a full session")

	require.Equal(t, http.StatusAccepted, e.do("POST", "/api/v1/auth/forgot-password", "", map[string]string{"email": "ana@example.com"}).status)
	res := e.do("POST", "/api/v1/auth/reset-password", "", map[string]string{"email": "ana@example.com", "code": e.lastCode("ana@example.com"), "new_password": "brand-new-pass"})
	require.Equal(t, http.StatusNoContent, res.status, res.raw)

	assert.Equal(t, http.StatusUnauthorized, e.do("POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": stolen}).status,
		"resetting the password kills the sessions a thief may hold")
}

func TestRemovedMembersLoseAccessEvenWithValidTokens(t *testing.T) {
	e := newEnv(t, false)
	ana := e.signUp("ana@example.com", "Ana")
	bob := e.signUp("bob@example.com", "Bob")
	acme := e.createOrg(ana, "Acme")
	inv := e.do("POST", "/api/v1/orgs/"+acme+"/invitations", ana, map[string]string{"email": "bob@example.com"})
	require.Equal(t, http.StatusCreated, inv.status)
	require.Equal(t, http.StatusOK, e.do("POST", "/api/v1/invitations/"+inv.id()+"/accept", bob, nil).status)

	login := e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "bob@example.com", "password": "s3cretpass"})
	refresh := login.str("refresh_token")
	bobMe := e.do("GET", "/api/v1/me", bob, nil)
	require.Equal(t, http.StatusNoContent, e.do("DELETE", "/api/v1/orgs/"+acme+"/members/"+bobMe.id(), ana, nil).status)

	// A fresh access token from the refresh token still cannot enter the organization.
	res := e.do("POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": refresh})
	require.Equal(t, http.StatusOK, res.status)
	assert.Equal(t, http.StatusForbidden, e.do("GET", "/api/v1/orgs/"+acme, res.str("token"), nil).status)
}

func TestTimesInResponsesAreUTC(t *testing.T) {
	e := newEnv(t, false)
	token := e.signUp("ana@example.com", "Ana")
	org := e.createOrg(token, "Acme")

	// An expiration sent with an offset comes back, and is stored, in UTC.
	res := e.do("POST", "/api/v1/orgs/"+org+"/links", token, map[string]any{"url": "https://example.com", "expires_at": "2099-03-04T10:00:00+05:00"})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	assert.Equal(t, "2099-03-04T05:00:00Z", res.str("expires_at"))
	assert.True(t, strings.HasSuffix(res.str("created_at"), "Z"))

	var stored string
	require.NoError(t, e.sql.QueryRowContext(context.Background(), `SELECT expires_at FROM links`).Scan(&stored))
	assert.Equal(t, "2099-03-04T05:00:00.000Z", stored)
}

// The key is bound to the tenant AND to the member who created it: when that member leaves
// the organization their keys stop working, while the keys of the others keep working.
func TestAPIKeyStopsWorkingWhenItsCreatorLeavesTheOrganization(t *testing.T) {
	e := newEnv(t, false)
	ana := e.signUp("ana@example.com", "Ana")
	bob := e.signUp("bob@example.com", "Bob")
	acme := e.createOrg(ana, "Acme")
	inv := e.do("POST", "/api/v1/orgs/"+acme+"/invitations", ana, map[string]string{"email": "bob@example.com"})
	require.Equal(t, http.StatusCreated, inv.status)
	require.Equal(t, http.StatusOK, e.do("POST", "/api/v1/invitations/"+inv.id()+"/accept", bob, nil).status)

	anaKey := e.do("POST", "/api/v1/orgs/"+acme+"/api-keys", ana, map[string]string{"name": "ana-ci", "scope": "write"}).str("secret")
	bobKey := e.do("POST", "/api/v1/orgs/"+acme+"/api-keys", bob, map[string]string{"name": "bob-ci", "scope": "write"}).str("secret")
	link := map[string]string{"url": "https://example.com"}
	assert.Equal(t, http.StatusCreated, e.do("POST", "/api/v1/orgs/"+acme+"/links", bobKey, link).status)

	bobMe := e.do("GET", "/api/v1/me", bob, nil)
	require.Equal(t, http.StatusNoContent, e.do("DELETE", "/api/v1/orgs/"+acme+"/members/"+bobMe.id(), ana, nil).status)

	res := e.do("POST", "/api/v1/orgs/"+acme+"/links", bobKey, link)
	assert.Equal(t, http.StatusForbidden, res.status)
	assert.Equal(t, "api_key_owner_not_member", res.errCode())
	assert.Equal(t, http.StatusCreated, e.do("POST", "/api/v1/orgs/"+acme+"/links", anaKey, link).status, "other members' keys are unaffected")
}

func TestAPIKeyScopes(t *testing.T) {
	e := newEnv(t, false)
	ana := e.signUp("ana@example.com", "Ana")
	acme := e.createOrg(ana, "Acme")
	keys := "/api/v1/orgs/" + acme + "/api-keys"
	link := map[string]string{"url": "https://example.com"}

	// The scope is required and checked.
	for _, body := range []map[string]string{{"name": "k"}, {"name": "k", "scope": ""}, {"name": "k", "scope": "admin"}, {"name": "k", "scope": "WRITE"}} {
		res := e.do("POST", keys, ana, body)
		assert.Equal(t, http.StatusBadRequest, res.status, "%v", body)
		assert.Equal(t, "invalid_scope", res.errCode(), "%v", body)
	}

	readKey := e.do("POST", keys, ana, map[string]string{"name": "reader", "scope": "read"})
	require.Equal(t, http.StatusCreated, readKey.status, readKey.raw)
	assert.Equal(t, "read", readKey.str("scope"))
	writeKey := e.do("POST", keys, ana, map[string]string{"name": "writer", "scope": "write"})
	require.Equal(t, http.StatusCreated, writeKey.status)

	// Creating a link needs write.
	res := e.do("POST", "/api/v1/orgs/"+acme+"/links", readKey.str("secret"), link)
	assert.Equal(t, http.StatusForbidden, res.status)
	assert.Equal(t, "insufficient_scope", res.errCode())
	assert.Contains(t, res.raw, "read", "the message says what the key has")
	assert.Equal(t, http.StatusCreated, e.do("POST", "/api/v1/orgs/"+acme+"/links", writeKey.str("secret"), link).status)
	assert.Equal(t, http.StatusCreated, e.do("POST", "/api/v1/orgs/"+acme+"/links", ana, link).status, "users are not limited by key scopes")

	// The listing shows each key's scope; the scope has no way to change.
	listed := e.do("GET", keys, ana, nil)
	assert.Contains(t, listed.raw, `"scope":"read"`)
	assert.Contains(t, listed.raw, `"scope":"write"`)
	patch := e.do("PATCH", keys+"/"+readKey.id(), ana, map[string]string{"scope": "write"})
	assert.Contains(t, []int{http.StatusNotFound, http.StatusMethodNotAllowed}, patch.status, "no endpoint changes a scope")
	assert.Equal(t, http.StatusForbidden, e.do("POST", "/api/v1/orgs/"+acme+"/links", readKey.str("secret"), link).status, "still read-only")

	// Scope does not widen what keys may reach: management stays closed to them.
	assert.Equal(t, "api_key_not_allowed", e.do("POST", keys, writeKey.str("secret"), map[string]string{"name": "x", "scope": "write"}).errCode())
}
