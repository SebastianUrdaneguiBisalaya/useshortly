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
} // @name DomainChallenge

type domainBody struct {
	ID         int64   `json:"id"`
	Host       string  `json:"host"`
	Verified   bool    `json:"verified"`
	VerifiedAt *string `json:"verified_at"`
	CreatedAt  string  `json:"created_at"`
	// Verification is the DNS record to create; it is left out once the domain is verified.
	Verification *challengeBody `json:"verification,omitempty"`
} // @name Domain

type CreateDomainRequest struct {
	Host string `json:"host"`
} // @name CreateDomainRequest

func (h *DomainHandler) body(d domain.Domain) domainBody {
	b := domainBody{ID: d.ID, Host: d.Host, Verified: d.Verified(), VerifiedAt: formatTimePtr(d.VerifiedAt), CreatedAt: formatTime(d.CreatedAt)}
	if !d.Verified() {
		c := h.domains.Challenge(d)
		b.Verification = &challengeBody{Type: c.Type, Name: c.Name, Value: c.Value}
	}
	return b
}

// Create registers a host for the organization. It answers with the DNS record to create.
//
//	@Summary		Add a custom domain
//	@Description	Answers with the DNS TXT record to create; verify it afterwards. Needs a JWT or an API key with the write scope.
//	@Tags			domains
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int					true	"Organization id"
//	@Param			body	body		CreateDomainRequest	true	"Host to serve links from"
//	@Success		201		{object}	DomainResponse
//	@Failure	400	{object}	ErrorResponse
//	@Failure	401	{object}	ErrorResponse
//	@Failure	403	{object}	ErrorResponse
//	@Failure	404	{object}	ErrorResponse
//	@Failure	409	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@Router			/orgs/{orgID}/domains [post]
func (h *DomainHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	var in CreateDomainRequest
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

// List answers one page of the organization's custom domains.
//
//	@Summary		List custom domains
//	@Description	Needs a JWT or an API key with the read scope.
//	@Tags			domains
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int	true	"Organization id"
//	@Param			limit	query		int	false	"Page size"
//	@Param			offset	query		int	false	"Items to skip"
//	@Success		200		{object}	DomainListResponse
//	@Failure	400	{object}	ErrorResponse
//	@Failure	401	{object}	ErrorResponse
//	@Failure	403	{object}	ErrorResponse
//	@Failure	404	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@Router			/orgs/{orgID}/domains [get]
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

// Get returns one custom domain, with its DNS record while it is not verified.
//
//	@Summary		Get a custom domain
//	@Description	Needs a JWT or an API key with the read scope.
//	@Tags			domains
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID		path		int	true	"Organization id"
//	@Param			domainID	path		int	true	"Domain id"
//	@Success		200			{object}	DomainResponse
//	@Failure	401	{object}	ErrorResponse
//	@Failure	403	{object}	ErrorResponse
//	@Failure	404	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@Router			/orgs/{orgID}/domains/{domainID} [get]
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
//
//	@Summary		Verify a custom domain
//	@Description	Checks the DNS TXT record. Needs a JWT or an API key with the write scope.
//	@Tags			domains
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID		path		int	true	"Organization id"
//	@Param			domainID	path		int	true	"Domain id"
//	@Success		200			{object}	DomainResponse
//	@Failure	400	{object}	ErrorResponse
//	@Failure	401	{object}	ErrorResponse
//	@Failure	403	{object}	ErrorResponse
//	@Failure	404	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@Router			/orgs/{orgID}/domains/{domainID}/verify [post]
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
//
//	@Summary		Delete a custom domain
//	@Description	Also deletes the links served from it. Needs a JWT or an API key with the write scope.
//	@Tags			domains
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID		path	int	true	"Organization id"
//	@Param			domainID	path	int	true	"Domain id"
//	@Success		204
//	@Failure	401	{object}	ErrorResponse
//	@Failure	403	{object}	ErrorResponse
//	@Failure	404	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@Router			/orgs/{orgID}/domains/{domainID} [delete]
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
