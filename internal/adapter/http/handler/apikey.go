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
	CreatedBy  int64   `json:"created_by"`
	LastUsedAt *string `json:"last_used_at"`
	ExpiresAt  *string `json:"expires_at"`
	CreatedAt  string  `json:"created_at"`
}

func newAPIKeyBody(k apikey.APIKey) apiKeyBody {
	return apiKeyBody{
		ID: k.ID, Name: k.Name, Prefix: k.Prefix, CreatedBy: k.CreatedBy,
		LastUsedAt: formatTimePtr(k.LastUsedAt), ExpiresAt: formatTimePtr(k.ExpiresAt), CreatedAt: formatTime(k.CreatedAt),
	}
}

// Create answers with the secret once; it cannot be read again.
func (h *APIKeyHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	var in struct {
		Name      string     `json:"name"`
		ExpiresAt *time.Time `json:"expires_at"`
	}
	if !decode(w, r, &in) {
		return
	}
	k, secret, err := h.keys.Create(r.Context(), tenant.ID, PrincipalFrom(r).UserID, in.Name, in.ExpiresAt)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, struct {
		apiKeyBody
		Secret string `json:"secret"`
	}{newAPIKeyBody(k), secret})
}

func (h *APIKeyHandler) List(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	list, err := h.keys.List(r.Context(), tenant.ID)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	out := make([]apiKeyBody, 0, len(list))
	for _, k := range list {
		out = append(out, newAPIKeyBody(k))
	}
	writeJSON(w, http.StatusOK, out)
}

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
