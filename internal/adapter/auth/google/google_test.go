package google

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/api/idtoken"
)

var _ user.GoogleAuth = (*Auth)(nil)

type fakeValidator struct {
	payload  *idtoken.Payload
	err      error
	idToken  string
	audience string
}

func (f *fakeValidator) Validate(_ context.Context, idToken, audience string) (*idtoken.Payload, error) {
	f.idToken, f.audience = idToken, audience
	return f.payload, f.err
}

func payload(issuer string, claims map[string]any) *idtoken.Payload {
	return &idtoken.Payload{Issuer: issuer, Subject: "g-123", Claims: claims}
}

var goodClaims = map[string]any{
	"email": "ana@example.com", "email_verified": true,
	"given_name": "Ana", "family_name": "Lopez", "picture": "https://img/a.png",
}

// newAuth points the adapter at a fake Google token endpoint.
func newAuth(t *testing.T, v *fakeValidator, handler http.HandlerFunc) *Auth {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return &Auth{
		validator: v, client: srv.Client(), tokenURL: srv.URL,
		web: Client{ID: "client-1", Secret: "secret-1"}, redirectURI: "postmessage",
		desktop: Client{ID: "desktop-1", Secret: "desktop-secret-1"},
	}
}

func tokenOK(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"access_token":"at","expires_in":3599,"scope":"openid email profile","token_type":"Bearer","id_token":"the-id-token"}`))
}

func TestExchangeSendsTheCodeAndTheSecretAndReturnsIdentityWithScope(t *testing.T) {
	var form url.Values
	v := &fakeValidator{payload: payload("https://accounts.google.com", goodClaims)}
	a := newAuth(t, v, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "application/x-www-form-urlencoded", r.Header.Get("Content-Type"))
		require.NoError(t, r.ParseForm())
		form = r.PostForm
		tokenOK(w, r)
	})

	id, err := a.Exchange(context.Background(), user.GoogleGrant{Code: "the-code"})
	require.NoError(t, err)
	assert.Equal(t, user.GoogleIdentity{
		Subject: "g-123", Email: "ana@example.com", EmailVerified: true,
		FirstName: "Ana", LastName: "Lopez", PictureURL: "https://img/a.png",
		Scope: "openid email profile",
	}, id)

	assert.Equal(t, "the-code", form.Get("code"))
	assert.Equal(t, "client-1", form.Get("client_id"))
	assert.Equal(t, "secret-1", form.Get("client_secret"), "the secret goes to Google, server to server")
	assert.Equal(t, "postmessage", form.Get("redirect_uri"))
	assert.Equal(t, "authorization_code", form.Get("grant_type"))
	assert.Equal(t, "the-id-token", v.idToken)
	assert.Equal(t, "client-1", v.audience, "the id token must be issued for our client id")
	assert.False(t, form.Has("code_verifier"))
}

// verifier is a valid PKCE code verifier (43 unreserved characters).
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

func TestExchangeDesktopGrantUsesTheDesktopClientAndPKCE(t *testing.T) {
	var form url.Values
	v := &fakeValidator{payload: payload("https://accounts.google.com", goodClaims)}
	a := newAuth(t, v, func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, r.ParseForm())
		form = r.PostForm
		tokenOK(w, r)
	})

	id, err := a.Exchange(context.Background(), user.GoogleGrant{Code: "the-code", RedirectURI: "http://127.0.0.1:53682/callback", CodeVerifier: verifier})
	require.NoError(t, err)
	assert.Equal(t, "g-123", id.Subject)

	assert.Equal(t, "desktop-1", form.Get("client_id"))
	assert.Equal(t, "desktop-secret-1", form.Get("client_secret"))
	assert.Equal(t, "http://127.0.0.1:53682/callback", form.Get("redirect_uri"))
	assert.Equal(t, verifier, form.Get("code_verifier"))
	assert.Equal(t, "desktop-1", v.audience, "the id token is issued for the desktop client")
}

func TestExchangeRefusesDesktopGrantsThatAreNotLoopbackWithPKCE(t *testing.T) {
	called := false
	a := newAuth(t, &fakeValidator{}, func(w http.ResponseWriter, _ *http.Request) { called = true })
	for _, g := range []user.GoogleGrant{
		{Code: "c", RedirectURI: "https://evil.example.com/cb", CodeVerifier: verifier},
		{Code: "c", RedirectURI: "http://localhost:53682/cb", CodeVerifier: verifier},
		{Code: "c", RedirectURI: "http://127.0.0.1/cb", CodeVerifier: verifier},
		{Code: "c", RedirectURI: "https://127.0.0.1:53682/cb", CodeVerifier: verifier},
		{Code: "c", RedirectURI: "http://user@127.0.0.1:53682/cb", CodeVerifier: verifier},
		{Code: "c", RedirectURI: "http://127.0.0.1:53682/cb"},
		{Code: "c", RedirectURI: "http://127.0.0.1:53682/cb", CodeVerifier: "too-short"},
		{Code: "c", RedirectURI: "http://127.0.0.1:53682/cb", CodeVerifier: verifier[:42] + "!"},
	} {
		_, err := a.Exchange(context.Background(), g)
		assert.ErrorIs(t, err, auth.ErrInvalidCredentials, "%+v", g)
	}
	assert.False(t, called, "a refused grant never reaches Google")
}

func TestExchangeDesktopGrantWithoutADesktopClientIsARealError(t *testing.T) {
	a := newAuth(t, &fakeValidator{}, tokenOK)
	a.desktop = Client{}
	_, err := a.Exchange(context.Background(), user.GoogleGrant{Code: "c", RedirectURI: "http://[::1]:53682/cb", CodeVerifier: verifier})
	require.Error(t, err)
	assert.NotErrorIs(t, err, auth.ErrInvalidCredentials, "the user is not at fault")
}

func TestExchangeRejectedCodeIsInvalidCredentials(t *testing.T) {
	a := newAuth(t, &fakeValidator{}, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"Bad Request"}`))
	})
	_, err := a.Exchange(context.Background(), user.GoogleGrant{Code: "used-code"})
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestExchangeOurMisconfigurationIsARealError(t *testing.T) {
	for _, body := range []string{
		`{"error":"invalid_client","error_description":"Unauthorized"}`,
		`{"error":"redirect_uri_mismatch"}`,
	} {
		a := newAuth(t, &fakeValidator{}, func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(body))
		})
		_, err := a.Exchange(context.Background(), user.GoogleGrant{Code: "code"})
		require.Error(t, err)
		assert.NotErrorIs(t, err, auth.ErrInvalidCredentials, "the user is not at fault: %s", body)
	}
}

func TestExchangeGoogleDownIsARealError(t *testing.T) {
	a := newAuth(t, &fakeValidator{}, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) })
	_, err := a.Exchange(context.Background(), user.GoogleGrant{Code: "code"})
	require.Error(t, err)
	assert.NotErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestExchangeEmptyCodeAndMissingIDToken(t *testing.T) {
	a := newAuth(t, &fakeValidator{}, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"scope":"openid"}`)) })
	_, err := a.Exchange(context.Background(), user.GoogleGrant{Code: ""})
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	_, err = a.Exchange(context.Background(), user.GoogleGrant{Code: "code"})
	assert.ErrorContains(t, err, "no id_token")
}

func TestExchangeRejectsABadIDToken(t *testing.T) {
	a := newAuth(t, &fakeValidator{err: errors.New("idtoken: token expired")}, tokenOK)
	_, err := a.Exchange(context.Background(), user.GoogleGrant{Code: "code"})
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)

	a = newAuth(t, &fakeValidator{payload: payload("https://evil.example.com", goodClaims)}, tokenOK)
	_, err = a.Exchange(context.Background(), user.GoogleGrant{Code: "code"})
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials, "wrong issuer")

	for _, iss := range []string{"accounts.google.com", "https://accounts.google.com"} {
		a = newAuth(t, &fakeValidator{payload: payload(iss, goodClaims)}, tokenOK)
		_, err = a.Exchange(context.Background(), user.GoogleGrant{Code: "code"})
		assert.NoError(t, err, iss)
	}
}

func TestEmailVerifiedForms(t *testing.T) {
	assert.True(t, verified(payload("", map[string]any{"email_verified": true})))
	assert.False(t, verified(payload("", map[string]any{"email_verified": false})))
	assert.True(t, verified(payload("", map[string]any{"email_verified": "true"})))
	assert.False(t, verified(payload("", map[string]any{"email_verified": "false"})))
	assert.False(t, verified(payload("", map[string]any{})), "missing means not verified")
	assert.False(t, verified(payload("", map[string]any{"email_verified": 1.0})))
}

func TestNewRequiresClientIDAndSecret(t *testing.T) {
	_, err := New(context.Background(), Client{Secret: "secret"}, "postmessage", Client{})
	assert.Error(t, err)
	_, err = New(context.Background(), Client{ID: "id"}, "postmessage", Client{})
	assert.Error(t, err)
	_, err = New(context.Background(), Client{ID: "id", Secret: "secret"}, "postmessage", Client{ID: "desktop"})
	assert.Error(t, err, "the desktop client needs its secret too")
}
