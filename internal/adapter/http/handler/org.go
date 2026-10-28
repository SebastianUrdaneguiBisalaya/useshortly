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
} // @name Organization

func newOrgBody(o org.Organization) orgBody {
	return orgBody{ID: o.ID, Name: o.Name, Description: o.Description, LogoURL: o.LogoURL, CreatedAt: formatTime(o.CreatedAt)}
}

type memberBody struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	Role      string `json:"role"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Email     string `json:"email"`
	ImageURL  string `json:"image_url,omitempty"`
	CreatedAt string `json:"created_at"`
} // @name Member

func newMemberBody(m org.Member) memberBody {
	return memberBody{
		ID: m.ID, UserID: m.UserID, Role: string(m.Role), FirstName: m.FirstName, LastName: m.LastName,
		Email: m.Email, ImageURL: m.ImageURL, CreatedAt: formatTime(m.CreatedAt),
	}
}

type invitationBody struct {
	ID        int64   `json:"id"`
	Email     string  `json:"email"`
	TenantID  int64   `json:"organization_id"`
	Role      string  `json:"role"`
	Status    string  `json:"status"`
	CreatedAt string  `json:"created_at"`
	ExpiresAt *string `json:"expires_at"`
} // @name Invitation

func newInvitationBody(i org.Invitation) invitationBody {
	return invitationBody{
		ID: i.ID, Email: i.Email, TenantID: i.TenantID, Role: string(i.Role), Status: string(i.Status),
		CreatedAt: formatTime(i.CreatedAt), ExpiresAt: formatTimePtr(i.ExpiresAt),
	}
}

type CreateOrganizationRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
} // @name CreateOrganizationRequest

type UpdateOrganizationRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
} // @name UpdateOrganizationRequest

type InviteRequest struct {
	Email string   `json:"email"`
	CC    []string `json:"cc"`
	BCC   []string `json:"bcc"`
} // @name InviteRequest

// Create makes an organization owned by the caller.
//
//	@Summary	Create an organization
//	@Tags		orgs
//	@Accept		json
//	@Produce	json
//	@Security	BearerAuth
//	@Param		body	body		CreateOrganizationRequest	true	"Organization data"
//	@Success	201		{object}	OrganizationResponse
//	@Failure	400		{object}	ErrorResponse
//	@Failure	401		{object}	ErrorResponse
//	@Failure	429		{object}	ErrorResponse
//	@ID	createOrganization
//	@Router		/orgs [post]
func (h *OrgHandler) Create(w http.ResponseWriter, r *http.Request) {
	var in CreateOrganizationRequest
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

// ListMine lists the organizations the caller belongs to.
//
//	@Summary	List my organizations
//	@Tags		orgs
//	@Produce	json
//	@Security	BearerAuth
//	@Success	200	{object}	OrganizationListResponse
//	@Failure	401	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@ID	listMyOrganizations
//	@Router		/orgs [get]
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

// Get returns one organization the caller belongs to.
//
//	@Summary	Get an organization
//	@Tags		orgs
//	@Produce	json
//	@Security	BearerAuth
//	@Param		orgID	path		int	true	"Organization id"
//	@Success	200		{object}	OrganizationResponse
//	@Failure	401		{object}	ErrorResponse
//	@Failure	403		{object}	ErrorResponse
//	@Failure	404		{object}	ErrorResponse
//	@Failure	429		{object}	ErrorResponse
//	@ID	getOrganization
//	@Router		/orgs/{orgID} [get]
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

// Update renames an organization and changes its description. Only its OWNER can.
//
//	@Summary	Update an organization
//	@Tags		orgs
//	@Accept		json
//	@Produce	json
//	@Security	BearerAuth
//	@Param		orgID	path		int							true	"Organization id"
//	@Param		body	body		UpdateOrganizationRequest	true	"Organization data"
//	@Success	200		{object}	OrganizationResponse
//	@Failure	400		{object}	ErrorResponse
//	@Failure	401		{object}	ErrorResponse
//	@Failure	403		{object}	ErrorResponse
//	@Failure	404		{object}	ErrorResponse
//	@Failure	409		{object}	ErrorResponse
//	@Failure	429		{object}	ErrorResponse
//	@ID	updateOrganization
//	@Router		/orgs/{orgID} [patch]
func (h *OrgHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	var in UpdateOrganizationRequest
	if !decode(w, r, &in) {
		return
	}
	o, err := h.orgs.Update(r.Context(), PrincipalFrom(r).UserID, tenant.ID, in.Name, in.Description)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, newOrgBody(o))
}

// Delete removes the organization with everything in it. Only its OWNER can. The organization is
// gone for every caller when this answers; its links and clicks are deleted in the background.
//
//	@Summary	Delete an organization
//	@Tags		orgs
//	@Produce	json
//	@Security	BearerAuth
//	@Param		orgID	path	int	true	"Organization id"
//	@Success	204
//	@Failure	401	{object}	ErrorResponse
//	@Failure	403	{object}	ErrorResponse
//	@Failure	404	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@ID	deleteOrganization
//	@Router		/orgs/{orgID} [delete]
func (h *OrgHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	if err := h.orgs.Delete(r.Context(), PrincipalFrom(r).UserID, tenant.ID); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListMembers lists the members of an organization.
//
//	@Summary	List members
//	@Tags		orgs
//	@Produce	json
//	@Security	BearerAuth
//	@Param		orgID	path		int	true	"Organization id"
//	@Success	200		{object}	MemberListResponse
//	@Failure	401		{object}	ErrorResponse
//	@Failure	403		{object}	ErrorResponse
//	@Failure	404		{object}	ErrorResponse
//	@Failure	429		{object}	ErrorResponse
//	@ID	listMembers
//	@Router		/orgs/{orgID}/members [get]
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
		out = append(out, newMemberBody(m))
	}
	writeData(w, http.StatusOK, out)
}

// RemoveMember removes a member from an organization.
//
//	@Summary	Remove a member
//	@Tags		orgs
//	@Produce	json
//	@Security	BearerAuth
//	@Param		orgID	path	int	true	"Organization id"
//	@Param		userID	path	int	true	"User id"
//	@Success	204
//	@Failure	401	{object}	ErrorResponse
//	@Failure	403	{object}	ErrorResponse
//	@Failure	404	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@ID	removeMember
//	@Router		/orgs/{orgID}/members/{userID} [delete]
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

// Invite emails an invitation to join the organization.
//
//	@Summary	Invite someone to an organization
//	@Tags		orgs
//	@Accept		json
//	@Produce	json
//	@Security	BearerAuth
//	@Param		orgID	path		int				true	"Organization id"
//	@Param		body	body		InviteRequest	true	"Invitee and optional copies"
//	@Success	201		{object}	InvitationResponse
//	@Failure	400		{object}	ErrorResponse
//	@Failure	401		{object}	ErrorResponse
//	@Failure	403		{object}	ErrorResponse
//	@Failure	404		{object}	ErrorResponse
//	@Failure	429		{object}	ErrorResponse
//	@ID	inviteMember
//	@Router		/orgs/{orgID}/invitations [post]
func (h *OrgHandler) Invite(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	var in InviteRequest
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

// ListInvitations lists the pending invitations of an organization.
//
//	@Summary	List pending invitations
//	@Tags		orgs
//	@Produce	json
//	@Security	BearerAuth
//	@Param		orgID	path		int	true	"Organization id"
//	@Success	200		{object}	InvitationListResponse
//	@Failure	401		{object}	ErrorResponse
//	@Failure	403		{object}	ErrorResponse
//	@Failure	404		{object}	ErrorResponse
//	@Failure	429		{object}	ErrorResponse
//	@ID	listInvitations
//	@Router		/orgs/{orgID}/invitations [get]
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
//
//	@Summary	Accept an invitation
//	@Tags		invitations
//	@Produce	json
//	@Security	BearerAuth
//	@Param		invitationID	path		int	true	"Invitation id"
//	@Success	200				{object}	MemberResponse
//	@Failure	401				{object}	ErrorResponse
//	@Failure	403				{object}	ErrorResponse
//	@Failure	404				{object}	ErrorResponse
//	@Failure	429				{object}	ErrorResponse
//	@ID	acceptInvitation
//	@Router		/invitations/{invitationID}/accept [post]
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
	m.FirstName, m.LastName, m.Email, m.ImageURL = p.User.FirstName, p.User.LastName, p.User.Email, p.User.ImageURL
	writeData(w, http.StatusOK, newMemberBody(m))
}

// RejectInvitation declines an invitation addressed to the caller's email.
//
//	@Summary	Reject an invitation
//	@Tags		invitations
//	@Produce	json
//	@Security	BearerAuth
//	@Param		invitationID	path	int	true	"Invitation id"
//	@Success	204
//	@Failure	401	{object}	ErrorResponse
//	@Failure	403	{object}	ErrorResponse
//	@Failure	404	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@ID	rejectInvitation
//	@Router		/invitations/{invitationID}/reject [post]
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
