package handler

import (
	"net/http"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
)

type AuthHandler struct {
	users  *user.Service
	google *user.GoogleService // nil when Google sign-in is not configured
	reset  *user.PasswordResetService
	delete *user.DeletionService // nil leaves account deletion out
}

// WithDeletion enables deleting the account (see RequestDeletion and DeleteAccount).
func (h *AuthHandler) WithDeletion(d *user.DeletionService) *AuthHandler {
	h.delete = d
	return h
}

func NewAuthHandler(users *user.Service, google *user.GoogleService, reset *user.PasswordResetService) *AuthHandler {
	return &AuthHandler{users: users, google: google, reset: reset}
}

// CanDelete reports whether account deletion is wired.
func (h *AuthHandler) CanDelete() bool { return h.delete != nil }

// HasGoogle reports whether POST /auth/google should be exposed.
func (h *AuthHandler) HasGoogle() bool { return h.google != nil }

type userBody struct {
	ID            int64   `json:"id"`
	Email         string  `json:"email"`
	EmailVerified bool    `json:"email_verified"`
	FirstName     string  `json:"first_name"`
	LastName      string  `json:"last_name"`
	ImageURL      string  `json:"image_url,omitempty"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     *string `json:"updated_at,omitempty"`
}

func newUserBody(u user.User) userBody {
	return userBody{
		ID: u.ID, Email: u.Email, EmailVerified: u.EmailVerified, FirstName: u.FirstName, LastName: u.LastName,
		ImageURL: u.ImageURL, CreatedAt: formatTime(u.CreatedAt), UpdatedAt: formatTimePtr(u.UpdatedAt),
	}
}

type sessionBody struct {
	User             userBody `json:"user"`
	Token            string   `json:"token"`
	ExpiresAt        string   `json:"expires_at"`
	RefreshToken     string   `json:"refresh_token"`
	RefreshExpiresAt string   `json:"refresh_expires_at"`
}

func writeSession(w http.ResponseWriter, status int, s user.Session) {
	// A session carries secrets: never let a proxy or the browser cache it.
	w.Header().Set("Cache-Control", "no-store")
	writeData(w, status, sessionBody{
		User: newUserBody(s.User), Token: s.Token.Value, ExpiresAt: formatTime(s.Token.ExpiresAt),
		RefreshToken: s.Refresh.Token, RefreshExpiresAt: formatTime(s.Refresh.ExpiresAt),
	})
}

// Register starts a signup: a code is emailed and the account only exists once it is verified.
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email     string `json:"email"`
		Password  string `json:"password"`
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
	}
	if !decode(w, r, &in) {
		return
	}
	err := h.users.Register(r.Context(), user.RegisterInput{
		Email: in.Email, Password: in.Password, FirstName: in.FirstName, LastName: in.LastName,
	})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusAccepted, map[string]string{"message": "a confirmation code was sent to the email"})
}

// VerifyRegistration checks the emailed code, creates the account and signs the user in.
func (h *AuthHandler) VerifyRegistration(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	s, err := h.users.VerifyRegistration(r.Context(), in.Email, in.Code)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeSession(w, http.StatusCreated, s)
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	s, err := h.users.Login(r.Context(), in.Email, in.Password)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeSession(w, http.StatusOK, s)
}

// Google signs in with the authorization code Google gave the client, creating the account
// on first use.
func (h *AuthHandler) Google(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	s, err := h.google.Login(r.Context(), in.Code)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeSession(w, http.StatusOK, s)
}

// Refresh trades a refresh token for a new access token and a new refresh token.
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !decode(w, r, &in) {
		return
	}
	s, err := h.users.Refresh(r.Context(), in.RefreshToken)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeSession(w, http.StatusOK, s)
}

// Logout revokes a refresh token. It answers 204 even for unknown tokens.
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := h.users.Logout(r.Context(), in.RefreshToken); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ForgotPassword always answers 202, whether or not the email has an account.
func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := h.reset.ForgotPassword(r.Context(), in.Email); err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusAccepted, map[string]string{"message": "if the email has an account, a code was sent"})
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email       string `json:"email"`
		Code        string `json:"code"`
		NewPassword string `json:"new_password"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := h.reset.ResetPassword(r.Context(), in.Email, in.Code, in.NewPassword); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Me returns the signed-in user.
// RequestDeletion emails the signed-in user the code that confirms deleting their account.
func (h *AuthHandler) RequestDeletion(w http.ResponseWriter, r *http.Request) {
	if err := h.delete.RequestCode(r.Context(), PrincipalFrom(r).UserID); err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusAccepted, map[string]string{"message": "a confirmation code was sent to your email"})
}

// DeleteAccount deletes the signed-in user, every organization they own and what is in them,
// once the emailed code is right. It cannot be undone.
func (h *AuthHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := h.delete.Delete(r.Context(), PrincipalFrom(r).UserID, in.Code); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	writeData(w, http.StatusOK, newUserBody(PrincipalFrom(r).User))
}
