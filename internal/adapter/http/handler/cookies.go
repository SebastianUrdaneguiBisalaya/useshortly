package handler

import (
	"net/http"
	"time"
)

// The session lives in two httpOnly cookies, so page scripts (and anything injected into them) can
// never read a token. The access token is sent with every API request; the refresh token only to
// the auth endpoints that use it, and SameSite=Strict keeps it off every cross-site request.
// SameSite=Lax on the access token, together with decode requiring application/json, is what
// stops a foreign site from acting as the user (CSRF). It also means the web app and the API
// must be served from the same site.
const (
	AccessCookie  = "access_token"
	RefreshCookie = "refresh_token"

	accessCookiePath  = "/api/v1"
	refreshCookiePath = "/api/v1/auth"
)

func sessionCookie(name, value, path string, sameSite http.SameSite, expires time.Time, secure bool) *http.Cookie {
	return &http.Cookie{
		Name: name, Value: value, Path: path, Expires: expires,
		MaxAge:   max(1, int(time.Until(expires).Seconds())),
		HttpOnly: true, Secure: secure, SameSite: sameSite,
	}
}

func expiredCookie(name, path string, sameSite http.SameSite, secure bool) *http.Cookie {
	return &http.Cookie{
		Name: name, Path: path, MaxAge: -1,
		HttpOnly: true, Secure: secure, SameSite: sameSite,
	}
}
