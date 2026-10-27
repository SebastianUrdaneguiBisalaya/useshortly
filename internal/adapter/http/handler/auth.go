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
} // @name User

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
} // @name Session

func writeSession(w http.ResponseWriter, status int, s user.Session) {
	// A session carries secrets: never let a proxy or the browser cache it.
	w.Header().Set("Cache-Control", "no-store")
	writeData(w, status, sessionBody{
		User: newUserBody(s.User), Token: s.Token.Value, ExpiresAt: formatTime(s.Token.ExpiresAt),
		RefreshToken: s.Refresh.Token, RefreshExpiresAt: formatTime(s.Refresh.ExpiresAt),
	})
}

type RegisterRequest struct {
	Email     string `json:"email"`
	Password  string `json:"password"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
} // @name RegisterRequest

type VerifyRegistrationRequest struct {
	Email string `json:"email"`
	Code  string `json:"code"`
} // @name VerifyRegistrationRequest

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
} // @name LoginRequest

type GoogleLoginRequest struct {
	Code string `json:"code"`
} // @name GoogleLoginRequest

type RefreshTokenRequest struct {
	RefreshToken string `json:"refresh_token"`
} // @name RefreshTokenRequest

type ForgotPasswordRequest struct {
	Email string `json:"email"`
} // @name ForgotPasswordRequest

type ResetPasswordRequest struct {
	Email       string `json:"email"`
	Code        string `json:"code"`
	NewPassword string `json:"new_password"`
} // @name ResetPasswordRequest

type ConfirmationCodeRequest struct {
	Code string `json:"code"`
} // @name ConfirmationCodeRequest

// Register starts a signup: a code is emailed and the account only exists once it is verified.
//
//	@Summary	Start a signup
//	@Tags		auth
//	@Accept		json
//	@Produce	json
//	@Param		body	body		RegisterRequest	true	"Account data"
//	@Success	202		{object}	MessageResponse
//	@Failure	400		{object}	ErrorResponse
//	@Failure	409		{object}	ErrorResponse
//	@Failure	429		{object}	ErrorResponse
//	@Router		/auth/register [post]
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var in RegisterRequest
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
//
//	@Summary	Confirm a signup and sign in
//	@Tags		auth
//	@Accept		json
//	@Produce	json
//	@Param		body	body		VerifyRegistrationRequest	true	"Email and emailed code"
//	@Success	201		{object}	SessionResponse
//	@Failure	400		{object}	ErrorResponse
//	@Failure	429		{object}	ErrorResponse
//	@Router		/auth/register/verify [post]
func (h *AuthHandler) VerifyRegistration(w http.ResponseWriter, r *http.Request) {
	var in VerifyRegistrationRequest
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

// Login signs in with email and password.
//
//	@Summary	Sign in
//	@Tags		auth
//	@Accept		json
//	@Produce	json
//	@Param		body	body		LoginRequest	true	"Credentials"
//	@Success	200		{object}	SessionResponse
//	@Failure	400		{object}	ErrorResponse
//	@Failure	401		{object}	ErrorResponse
//	@Failure	429		{object}	ErrorResponse
//	@Router		/auth/login [post]
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var in LoginRequest
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
//
//	@Summary		Sign in with Google
//	@Description	Only available when Google sign-in is configured on the server.
//	@Tags			auth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		GoogleLoginRequest	true	"Google authorization code"
//	@Success		200		{object}	SessionResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@Router			/auth/google [post]
func (h *AuthHandler) Google(w http.ResponseWriter, r *http.Request) {
	var in GoogleLoginRequest
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
//
//	@Summary	Refresh a session
//	@Tags		auth
//	@Accept		json
//	@Produce	json
//	@Param		body	body		RefreshTokenRequest	true	"Refresh token"
//	@Success	200		{object}	SessionResponse
//	@Failure	400		{object}	ErrorResponse
//	@Failure	401		{object}	ErrorResponse
//	@Failure	429		{object}	ErrorResponse
//	@Router		/auth/refresh [post]
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var in RefreshTokenRequest
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
//
//	@Summary	Sign out
//	@Tags		auth
//	@Accept		json
//	@Param		body	body	RefreshTokenRequest	true	"Refresh token to revoke"
//	@Success	204
//	@Failure	400	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@Router		/auth/logout [post]
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	var in RefreshTokenRequest
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
//
//	@Summary	Request a password reset code
//	@Tags		auth
//	@Accept		json
//	@Produce	json
//	@Param		body	body		ForgotPasswordRequest	true	"Account email"
//	@Success	202		{object}	MessageResponse
//	@Failure	400		{object}	ErrorResponse
//	@Failure	429		{object}	ErrorResponse
//	@Router		/auth/forgot-password [post]
func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var in ForgotPasswordRequest
	if !decode(w, r, &in) {
		return
	}
	if err := h.reset.ForgotPassword(r.Context(), in.Email); err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusAccepted, map[string]string{"message": "if the email has an account, a code was sent"})
}

// ResetPassword sets a new password with the emailed code.
//
//	@Summary	Reset a password
//	@Tags		auth
//	@Accept		json
//	@Param		body	body	ResetPasswordRequest	true	"Email, emailed code and new password"
//	@Success	204
//	@Failure	400	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@Router		/auth/reset-password [post]
func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var in ResetPasswordRequest
	if !decode(w, r, &in) {
		return
	}
	if err := h.reset.ResetPassword(r.Context(), in.Email, in.Code, in.NewPassword); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RequestDeletion emails the signed-in user the code that confirms deleting their account.
//
//	@Summary		Request an account deletion code
//	@Description	Only available when account deletion is enabled on the server.
//	@Tags			me
//	@Produce		json
//	@Security		BearerAuth
//	@Success		202	{object}	MessageResponse
//	@Failure		401	{object}	ErrorResponse
//	@Failure		429	{object}	ErrorResponse
//	@Router			/me/delete-code [post]
func (h *AuthHandler) RequestDeletion(w http.ResponseWriter, r *http.Request) {
	if err := h.delete.RequestCode(r.Context(), PrincipalFrom(r).UserID); err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusAccepted, map[string]string{"message": "a confirmation code was sent to your email"})
}

// DeleteAccount deletes the signed-in user, every organization they own and what is in them,
// once the emailed code is right. It cannot be undone.
//
//	@Summary		Delete the account
//	@Description	Deletes the user, every organization they own and what is in them. It cannot be undone.
//	@Tags			me
//	@Accept			json
//	@Security		BearerAuth
//	@Param			body	body	ConfirmationCodeRequest	true	"Emailed confirmation code"
//	@Success		204
//	@Failure		400	{object}	ErrorResponse
//	@Failure		401	{object}	ErrorResponse
//	@Failure		429	{object}	ErrorResponse
//	@Router			/me [delete]
func (h *AuthHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	var in ConfirmationCodeRequest
	if !decode(w, r, &in) {
		return
	}
	if err := h.delete.Delete(r.Context(), PrincipalFrom(r).UserID, in.Code); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Me returns the signed-in user.
//
//	@Summary	Get the signed-in user
//	@Tags		me
//	@Produce	json
//	@Security	BearerAuth
//	@Success	200	{object}	UserResponse
//	@Failure	401	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@Router		/me [get]
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	writeData(w, http.StatusOK, newUserBody(PrincipalFrom(r).User))
}
