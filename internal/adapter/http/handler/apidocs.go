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

// LinkData answers with one short link.
type LinkData struct {
	Data linkBody `json:"data"`
} // @name LinkResponse

// LinkListData answers with one page of links.
type LinkListData struct {
	Data []linkBody `json:"data"`
	Meta pageMeta   `json:"meta"`
} // @name LinkListResponse

// UnlockPageData answers with an unlock page.
type UnlockPageData struct {
	Data unlockPageBody `json:"data"`
} // @name UnlockPageResponse

// UnlockPageHistoryData answers with one page of unlock page changes.
type UnlockPageHistoryData struct {
	Data []unlockPageEventBody `json:"data"`
	Meta pageMeta              `json:"meta"`
} // @name UnlockPageHistoryResponse

// DomainData answers with one custom domain.
type DomainData struct {
	Data domainBody `json:"data"`
} // @name DomainResponse

// DomainListData answers with one page of custom domains.
type DomainListData struct {
	Data []domainBody `json:"data"`
	Meta pageMeta     `json:"meta"`
} // @name DomainListResponse

// LinkStatsData answers with the clicks of one link.
type LinkStatsData struct {
	Data statsBody `json:"data"`
} // @name LinkStatsResponse

// CampaignData answers with one campaign.
type CampaignData struct {
	Data campaignBody `json:"data"`
} // @name CampaignResponse

// CampaignListData answers with one page of campaigns.
type CampaignListData struct {
	Data []campaignBody `json:"data"`
	Meta pageMeta       `json:"meta"`
} // @name CampaignListResponse

// CampaignChannelData answers with one campaign channel.
type CampaignChannelData struct {
	Data channelBody `json:"data"`
} // @name CampaignChannelResponse

// CampaignChannelListData answers with one page of campaign channels.
type CampaignChannelListData struct {
	Data []channelBody `json:"data"`
	Meta pageMeta      `json:"meta"`
} // @name CampaignChannelListResponse

// CampaignStatsData answers with the clicks of one campaign.
type CampaignStatsData struct {
	Data campaignStatsBody `json:"data"`
} // @name CampaignStatsResponse
