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
		clientID: "client-1", clientSecret: "secret-1", redirectURI: "postmessage",
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

	id, err := a.Exchange(context.Background(), "the-code")
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
}

func TestExchangeRejectedCodeIsInvalidCredentials(t *testing.T) {
	a := newAuth(t, &fakeValidator{}, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"Bad Request"}`))
	})
	_, err := a.Exchange(context.Background(), "used-code")
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
		_, err := a.Exchange(context.Background(), "code")
		require.Error(t, err)
		assert.NotErrorIs(t, err, auth.ErrInvalidCredentials, "the user is not at fault: %s", body)
	}
}

func TestExchangeGoogleDownIsARealError(t *testing.T) {
	a := newAuth(t, &fakeValidator{}, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) })
	_, err := a.Exchange(context.Background(), "code")
	require.Error(t, err)
	assert.NotErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestExchangeEmptyCodeAndMissingIDToken(t *testing.T) {
	a := newAuth(t, &fakeValidator{}, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"scope":"openid"}`)) })
	_, err := a.Exchange(context.Background(), "")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	_, err = a.Exchange(context.Background(), "code")
	assert.ErrorContains(t, err, "no id_token")
}

func TestExchangeRejectsABadIDToken(t *testing.T) {
	a := newAuth(t, &fakeValidator{err: errors.New("idtoken: token expired")}, tokenOK)
	_, err := a.Exchange(context.Background(), "code")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)

	a = newAuth(t, &fakeValidator{payload: payload("https://evil.example.com", goodClaims)}, tokenOK)
	_, err = a.Exchange(context.Background(), "code")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials, "wrong issuer")

	for _, iss := range []string{"accounts.google.com", "https://accounts.google.com"} {
		a = newAuth(t, &fakeValidator{payload: payload(iss, goodClaims)}, tokenOK)
		_, err = a.Exchange(context.Background(), "code")
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
	_, err := New(context.Background(), "", "secret", "postmessage")
	assert.Error(t, err)
	_, err = New(context.Background(), "id", "", "postmessage")
	assert.Error(t, err)
}
