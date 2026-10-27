package handler

// Types in this file exist only so swag can describe the {"data": ...} envelope of each answer;
// the handlers keep writing it through writeData and writePage.

// MessageData is an answer that only carries a human readable message.
type MessageData struct {
	Data struct {
		Message string `json:"message"`
	} `json:"data"`
} // @name MessageResponse

// UserData answers with one user.
type UserData struct {
	Data userBody `json:"data"`
} // @name UserResponse

// SessionData answers with a user and the tokens that sign them in.
type SessionData struct {
	Data sessionBody `json:"data"`
} // @name SessionResponse

// OrganizationData answers with one organization.
type OrganizationData struct {
	Data orgBody `json:"data"`
} // @name OrganizationResponse

// OrganizationListData answers with the caller's organizations.
type OrganizationListData struct {
	Data []orgBody `json:"data"`
} // @name OrganizationListResponse

// MemberData answers with one member.
type MemberData struct {
	Data memberBody `json:"data"`
} // @name MemberResponse

// MemberListData answers with the members of an organization.
type MemberListData struct {
	Data []memberBody `json:"data"`
} // @name MemberListResponse

// InvitationData answers with one invitation.
type InvitationData struct {
	Data invitationBody `json:"data"`
} // @name InvitationResponse

// InvitationListData answers with the pending invitations of an organization.
type InvitationListData struct {
	Data []invitationBody `json:"data"`
} // @name InvitationListResponse

// APIKeyCreatedData answers with a new API key and its one-time secret.
type APIKeyCreatedData struct {
	Data apiKeyCreatedBody `json:"data"`
} // @name APIKeyCreatedResponse

// APIKeyListData answers with one page of API keys.
type APIKeyListData struct {
	Data []apiKeyBody `json:"data"`
	Meta pageMeta     `json:"meta"`
} // @name APIKeyListResponse
