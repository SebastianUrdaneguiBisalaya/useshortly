package handler

import (
	"net/http"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/domain"
)

type DomainHandler struct {
	domains *domain.Service
}

func NewDomainHandler(domains *domain.Service) *DomainHandler {
	return &DomainHandler{domains: domains}
}

type challengeBody struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

type domainBody struct {
	ID         int64   `json:"id"`
	Host       string  `json:"host"`
	Verified   bool    `json:"verified"`
	VerifiedAt *string `json:"verified_at"`
	CreatedAt  string  `json:"created_at"`
	// Verification is the DNS record to create; it is left out once the domain is verified.
	Verification *challengeBody `json:"verification,omitempty"`
}

func (h *DomainHandler) body(d domain.Domain) domainBody {
	b := domainBody{ID: d.ID, Host: d.Host, Verified: d.Verified(), VerifiedAt: formatTimePtr(d.VerifiedAt), CreatedAt: formatTime(d.CreatedAt)}
	if !d.Verified() {
		c := h.domains.Challenge(d)
		b.Verification = &challengeBody{Type: c.Type, Name: c.Name, Value: c.Value}
	}
	return b
}

// Create registers a host for the organization. It answers with the DNS record to create.
func (h *DomainHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	var in struct {
		Host string `json:"host"`
	}
	if !decode(w, r, &in) {
		return
	}
	d, err := h.domains.Add(r.Context(), tenant.ID, in.Host)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusCreated, h.body(d))
}

func (h *DomainHandler) List(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	p, ok := pageParams(w, r)
	if !ok {
		return
	}
	list, total, err := h.domains.List(r.Context(), tenant.ID, p)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	out := make([]domainBody, 0, len(list))
	for _, d := range list {
		out = append(out, h.body(d))
	}
	writePage(w, out, p, total)
}

func (h *DomainHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	id, ok := idParam(w, r, "domainID")
	if !ok {
		return
	}
	d, err := h.domains.Get(r.Context(), tenant.ID, id)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, h.body(d))
}

// Verify looks for the DNS record and, if it is there, marks the domain verified.
func (h *DomainHandler) Verify(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	id, ok := idParam(w, r, "domainID")
	if !ok {
		return
	}
	d, err := h.domains.Verify(r.Context(), tenant.ID, id)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, h.body(d))
}

// Delete removes the domain and the links served from it.
func (h *DomainHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	id, ok := idParam(w, r, "domainID")
	if !ok {
		return
	}
	if err := h.domains.Delete(r.Context(), tenant.ID, id); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
