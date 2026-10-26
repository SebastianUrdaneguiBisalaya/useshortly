package handler

import (
	"net/http"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/org"
)

type OrgHandler struct {
	orgs *org.Service
}

func NewOrgHandler(orgs *org.Service) *OrgHandler {
	return &OrgHandler{orgs: orgs}
}

type orgBody struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	LogoURL     string `json:"logo_url,omitempty"`
	CreatedAt   string `json:"created_at"`
}

func newOrgBody(o org.Organization) orgBody {
	return orgBody{ID: o.ID, Name: o.Name, Description: o.Description, LogoURL: o.LogoURL, CreatedAt: formatTime(o.CreatedAt)}
}

type memberBody struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
}

type invitationBody struct {
	ID        int64   `json:"id"`
	Email     string  `json:"email"`
	TenantID  int64   `json:"organization_id"`
	Role      string  `json:"role"`
	Status    string  `json:"status"`
	CreatedAt string  `json:"created_at"`
	ExpiresAt *string `json:"expires_at"`
}

func newInvitationBody(i org.Invitation) invitationBody {
	return invitationBody{
		ID: i.ID, Email: i.Email, TenantID: i.TenantID, Role: string(i.Role), Status: string(i.Status),
		CreatedAt: formatTime(i.CreatedAt), ExpiresAt: formatTimePtr(i.ExpiresAt),
	}
}

func (h *OrgHandler) Create(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if !decode(w, r, &in) {
		return
	}
	o, err := h.orgs.CreateOrganization(r.Context(), PrincipalFrom(r).UserID, in.Name, in.Description)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusCreated, newOrgBody(o))
}

func (h *OrgHandler) ListMine(w http.ResponseWriter, r *http.Request) {
	list, err := h.orgs.ListMine(r.Context(), PrincipalFrom(r).UserID)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	out := make([]orgBody, 0, len(list))
	for _, o := range list {
		out = append(out, newOrgBody(o))
	}
	writeData(w, http.StatusOK, out)
}

func (h *OrgHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	o, err := h.orgs.Get(r.Context(), PrincipalFrom(r).UserID, tenant.ID)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, newOrgBody(o))
}

func (h *OrgHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	list, err := h.orgs.ListMembers(r.Context(), PrincipalFrom(r).UserID, tenant.ID)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	out := make([]memberBody, 0, len(list))
	for _, m := range list {
		out = append(out, memberBody{ID: m.ID, UserID: m.UserID, Role: string(m.Role), CreatedAt: formatTime(m.CreatedAt)})
	}
	writeData(w, http.StatusOK, out)
}

func (h *OrgHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	userID, ok := idParam(w, r, "userID")
	if !ok {
		return
	}
	if err := h.orgs.RemoveMember(r.Context(), PrincipalFrom(r).UserID, tenant.ID, userID); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *OrgHandler) Invite(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	var in struct {
		Email string   `json:"email"`
		CC    []string `json:"cc"`
		BCC   []string `json:"bcc"`
	}
	if !decode(w, r, &in) {
		return
	}
	p := PrincipalFrom(r)
	inv, err := h.orgs.Invite(r.Context(), p.UserID, tenant.ID, p.User.FirstName+" "+p.User.LastName, in.Email,
		org.InviteOptions{CC: in.CC, BCC: in.BCC})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusCreated, newInvitationBody(inv))
}

func (h *OrgHandler) ListInvitations(w http.ResponseWriter, r *http.Request) {
	orgID, ok := idParam(w, r, "orgID")
	if !ok {
		return
	}
	list, err := h.orgs.ListPendingInvitations(r.Context(), PrincipalFrom(r).UserID, orgID)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	out := make([]invitationBody, 0, len(list))
	for _, i := range list {
		out = append(out, newInvitationBody(i))
	}
	writeData(w, http.StatusOK, out)
}

// AcceptInvitation joins the caller to the organization that invited their email.
func (h *OrgHandler) AcceptInvitation(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "invitationID")
	if !ok {
		return
	}
	p := PrincipalFrom(r)
	m, err := h.orgs.AcceptInvitation(r.Context(), p.UserID, p.User.Email, p.User.EmailVerified, id)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, memberBody{ID: m.ID, UserID: m.UserID, Role: string(m.Role), CreatedAt: formatTime(m.CreatedAt)})
}

func (h *OrgHandler) RejectInvitation(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "invitationID")
	if !ok {
		return
	}
	if err := h.orgs.RejectInvitation(r.Context(), PrincipalFrom(r).User.Email, id); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
