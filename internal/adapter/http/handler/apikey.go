package handler

import (
	"net/http"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
)

type APIKeyHandler struct {
	keys *apikey.Service
}

func NewAPIKeyHandler(keys *apikey.Service) *APIKeyHandler {
	return &APIKeyHandler{keys: keys}
}

type apiKeyBody struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	Prefix     string  `json:"prefix"`
	Scope      string  `json:"scope"`
	CreatedBy  int64   `json:"created_by"`
	LastUsedAt *string `json:"last_used_at"`
	ExpiresAt  *string `json:"expires_at"`
	CreatedAt  string  `json:"created_at"`
} // @name APIKey

// apiKeyCreatedBody is what creating a key answers: the key plus its secret, shown only once.
type apiKeyCreatedBody struct {
	apiKeyBody
	Secret string `json:"secret"`
} // @name APIKeyCreated

func newAPIKeyBody(k apikey.APIKey) apiKeyBody {
	return apiKeyBody{
		ID: k.ID, Name: k.Name, Prefix: k.Prefix, Scope: string(k.Scope), CreatedBy: k.CreatedBy,
		LastUsedAt: formatTimePtr(k.LastUsedAt), ExpiresAt: formatTimePtr(k.ExpiresAt), CreatedAt: formatTime(k.CreatedAt),
	}
}

type CreateAPIKeyRequest struct {
	Name      string     `json:"name"`
	Scope     string     `json:"scope" enums:"read,write"`
	ExpiresAt *time.Time `json:"expires_at"`
} // @name CreateAPIKeyRequest

// Create answers with the secret once; it cannot be read again. The scope (read or write)
// is required and cannot be changed afterwards.
//
//	@Summary		Create an API key
//	@Description	The secret is returned once and cannot be read again. The scope cannot be changed afterwards.
//	@Tags			api-keys
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int					true	"Organization id"
//	@Param			body	body		CreateAPIKeyRequest	true	"Key name, scope and optional expiry"
//	@Success		201		{object}	APIKeyCreatedResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@ID	createApiKey
//	@Router			/orgs/{orgID}/api-keys [post]
func (h *APIKeyHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	var in CreateAPIKeyRequest
	if !decode(w, r, &in) {
		return
	}
	k, secret, err := h.keys.Create(r.Context(), tenant.ID, PrincipalFrom(r).UserID, in.Name, apikey.Scope(in.Scope), in.ExpiresAt)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusCreated, apiKeyCreatedBody{newAPIKeyBody(k), secret})
}

// List returns the organization's API keys, never their secrets.
//
//	@Summary	List API keys
//	@Tags		api-keys
//	@Produce	json
//	@Security	BearerAuth
//	@Param		orgID	path		int	true	"Organization id"
//	@Param		limit	query		int	false	"Page size"
//	@Param		offset	query		int	false	"Items to skip"
//	@Success	200		{object}	APIKeyListResponse
//	@Failure	400		{object}	ErrorResponse
//	@Failure	401		{object}	ErrorResponse
//	@Failure	403		{object}	ErrorResponse
//	@Failure	404		{object}	ErrorResponse
//	@Failure	429		{object}	ErrorResponse
//	@ID	listApiKeys
//	@Router		/orgs/{orgID}/api-keys [get]
func (h *APIKeyHandler) List(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	p, ok := pageParams(w, r)
	if !ok {
		return
	}
	list, total, err := h.keys.List(r.Context(), tenant.ID, p)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	out := make([]apiKeyBody, 0, len(list))
	for _, k := range list {
		out = append(out, newAPIKeyBody(k))
	}
	writePage(w, out, p, total)
}

// Delete revokes an API key.
//
//	@Summary	Delete an API key
//	@Tags		api-keys
//	@Produce	json
//	@Security	BearerAuth
//	@Param		orgID	path	int	true	"Organization id"
//	@Param		keyID	path	int	true	"API key id"
//	@Success	204
//	@Failure	401	{object}	ErrorResponse
//	@Failure	403	{object}	ErrorResponse
//	@Failure	404	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@ID	deleteApiKey
//	@Router		/orgs/{orgID}/api-keys/{keyID} [delete]
func (h *APIKeyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	keyID, ok := idParam(w, r, "keyID")
	if !ok {
		return
	}
	if err := h.keys.Delete(r.Context(), tenant.ID, keyID); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
