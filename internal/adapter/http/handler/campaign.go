package handler

import (
	"encoding/csv"
	"net/http"
	"strconv"
	"strings"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/campaign"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
)

type CampaignHandler struct {
	campaigns *campaign.Service
	baseURL   string // public URL short links are served from
}

func NewCampaignHandler(campaigns *campaign.Service, baseURL string) *CampaignHandler {
	return &CampaignHandler{campaigns: campaigns, baseURL: strings.TrimRight(baseURL, "/")}
}

type campaignBody struct {
	ID           int64   `json:"id"`
	Name         string  `json:"name"`
	Description  string  `json:"description"`
	ChannelCount int64   `json:"channel_count"`
	LinkCount    int64   `json:"link_count"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    *string `json:"updated_at"`
} // @name Campaign

type channelBody struct {
	ID         int64  `json:"id"`
	CampaignID int64  `json:"campaign_id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"created_at"`
} // @name CampaignChannel

func campaignOf(c campaign.Campaign) campaignBody {
	return campaignBody{
		ID: c.ID, Name: c.Name, Description: c.Description, ChannelCount: c.ChannelCount, LinkCount: c.LinkCount,
		CreatedAt: formatTime(c.CreatedAt), UpdatedAt: formatTimePtr(c.UpdatedAt),
	}
}

func channelOf(c campaign.Channel) channelBody {
	return channelBody{ID: c.ID, CampaignID: c.CampaignID, Name: c.Name, CreatedAt: formatTime(c.CreatedAt)}
}

type CreateCampaignRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
} // @name CreateCampaignRequest

// Create makes a campaign of the organization.
//
//	@Summary		Create a campaign
//	@Description	A campaign groups links by marketing initiative; add channels to it, then put links in the channels. The name is unique in the organization, ignoring case. Needs a JWT or an API key with the write scope.
//	@Tags			campaigns
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int						true	"Organization id"
//	@Param			body	body		CreateCampaignRequest	true	"Campaign to create"
//	@Success		201		{object}	CampaignResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		409		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@ID	createCampaign
//	@Router			/orgs/{orgID}/campaigns [post]
func (h *CampaignHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	var in CreateCampaignRequest
	if !decode(w, r, &in) {
		return
	}
	c, err := h.campaigns.Create(r.Context(), campaign.CreateInput{
		TenantID: tenant.ID, UserID: PrincipalFrom(r).UserID, Name: in.Name, Description: in.Description,
	})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusCreated, campaignOf(c))
}

// List answers one page of the organization's campaigns, newest first.
//
//	@Summary		List campaigns
//	@Description	Needs a JWT or an API key with the read scope.
//	@Tags			campaigns
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int	true	"Organization id"
//	@Param			limit	query		int	false	"Page size"
//	@Param			offset	query		int	false	"Items to skip"
//	@Success		200		{object}	CampaignListResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@ID	listCampaigns
//	@Router			/orgs/{orgID}/campaigns [get]
func (h *CampaignHandler) List(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	p, ok := pageParams(w, r)
	if !ok {
		return
	}
	list, total, err := h.campaigns.List(r.Context(), tenant.ID, p)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	out := make([]campaignBody, 0, len(list))
	for _, c := range list {
		out = append(out, campaignOf(c))
	}
	writePage(w, out, p, total)
}

// Get answers one campaign of the organization; one of another organization is a 404.
//
//	@Summary		Get a campaign
//	@Description	Needs a JWT or an API key with the read scope.
//	@Tags			campaigns
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID		path		int	true	"Organization id"
//	@Param			campaignID	path		int	true	"Campaign id"
//	@Success		200			{object}	CampaignResponse
//	@Failure		401			{object}	ErrorResponse
//	@Failure		403			{object}	ErrorResponse
//	@Failure		404			{object}	ErrorResponse
//	@Failure		429			{object}	ErrorResponse
//	@ID	getCampaign
//	@Router			/orgs/{orgID}/campaigns/{campaignID} [get]
func (h *CampaignHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	id, ok := idParam(w, r, "campaignID")
	if !ok {
		return
	}
	c, err := h.campaigns.Get(r.Context(), tenant.ID, id)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, campaignOf(c))
}

// UpdateCampaignRequest changes a campaign; a missing field is left as it is.
type UpdateCampaignRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
} // @name UpdateCampaignRequest

// Update changes the name and/or the description of a campaign of the organization.
//
//	@Summary		Update a campaign
//	@Description	Links already in the campaign keep the utm_campaign they were given; a new name only reaches the links put in its channels afterwards. Needs a JWT or an API key with the write scope.
//	@Tags			campaigns
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID		path		int						true	"Organization id"
//	@Param			campaignID	path		int						true	"Campaign id"
//	@Param			body		body		UpdateCampaignRequest	true	"Fields to change"
//	@Success		200			{object}	CampaignResponse
//	@Failure		400			{object}	ErrorResponse
//	@Failure		401			{object}	ErrorResponse
//	@Failure		403			{object}	ErrorResponse
//	@Failure		404			{object}	ErrorResponse
//	@Failure		409			{object}	ErrorResponse
//	@Failure		429			{object}	ErrorResponse
//	@ID	updateCampaign
//	@Router			/orgs/{orgID}/campaigns/{campaignID} [patch]
func (h *CampaignHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	id, ok := idParam(w, r, "campaignID")
	if !ok {
		return
	}
	var in UpdateCampaignRequest
	if !decode(w, r, &in) {
		return
	}
	c, err := h.campaigns.Update(r.Context(), campaign.UpdateInput{TenantID: tenant.ID, ID: id, Name: in.Name, Description: in.Description})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, campaignOf(c))
}

// Delete removes a campaign of the organization with its channels.
//
//	@Summary		Delete a campaign
//	@Description	Removes the campaign and its channels. Its links stay, outside every campaign, and keep the UTM parameters they already carry. Needs a JWT or an API key with the write scope.
//	@Tags			campaigns
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID		path	int	true	"Organization id"
//	@Param			campaignID	path	int	true	"Campaign id"
//	@Success		204
//	@Failure		401	{object}	ErrorResponse
//	@Failure		403	{object}	ErrorResponse
//	@Failure		404	{object}	ErrorResponse
//	@Failure		429	{object}	ErrorResponse
//	@ID	deleteCampaign
//	@Router			/orgs/{orgID}/campaigns/{campaignID} [delete]
func (h *CampaignHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	id, ok := idParam(w, r, "campaignID")
	if !ok {
		return
	}
	if err := h.campaigns.Delete(r.Context(), tenant.ID, id); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type CreateChannelRequest struct {
	Name string `json:"name"`
} // @name CreateChannelRequest

// CreateChannel adds a channel to a campaign of the organization.
//
//	@Summary		Add a channel to a campaign
//	@Description	A channel is a place the campaign is shared (Instagram, email...). Its name becomes the utm_source of the links put in it, so it is unique in the campaign, ignoring case. A campaign has at most 100 channels. Needs a JWT or an API key with the write scope.
//	@Tags			campaigns
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID		path		int						true	"Organization id"
//	@Param			campaignID	path		int						true	"Campaign id"
//	@Param			body		body		CreateChannelRequest	true	"Channel to create"
//	@Success		201			{object}	CampaignChannelResponse
//	@Failure		400			{object}	ErrorResponse
//	@Failure		401			{object}	ErrorResponse
//	@Failure		403			{object}	ErrorResponse
//	@Failure		404			{object}	ErrorResponse
//	@Failure		409			{object}	ErrorResponse
//	@Failure		429			{object}	ErrorResponse
//	@ID	createCampaignChannel
//	@Router			/orgs/{orgID}/campaigns/{campaignID}/channels [post]
func (h *CampaignHandler) CreateChannel(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	id, ok := idParam(w, r, "campaignID")
	if !ok {
		return
	}
	var in CreateChannelRequest
	if !decode(w, r, &in) {
		return
	}
	ch, err := h.campaigns.AddChannel(r.Context(), tenant.ID, id, in.Name)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeData(w, http.StatusCreated, channelOf(ch))
}

// ListChannels answers one page of the channels of a campaign, oldest first.
//
//	@Summary		List the channels of a campaign
//	@Description	Needs a JWT or an API key with the read scope.
//	@Tags			campaigns
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID		path		int	true	"Organization id"
//	@Param			campaignID	path		int	true	"Campaign id"
//	@Param			limit		query		int	false	"Page size"
//	@Param			offset		query		int	false	"Items to skip"
//	@Success		200			{object}	CampaignChannelListResponse
//	@Failure		400			{object}	ErrorResponse
//	@Failure		401			{object}	ErrorResponse
//	@Failure		403			{object}	ErrorResponse
//	@Failure		404			{object}	ErrorResponse
//	@Failure		429			{object}	ErrorResponse
//	@ID	listCampaignChannels
//	@Router			/orgs/{orgID}/campaigns/{campaignID}/channels [get]
func (h *CampaignHandler) ListChannels(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	id, ok := idParam(w, r, "campaignID")
	if !ok {
		return
	}
	p, ok := pageParams(w, r)
	if !ok {
		return
	}
	list, total, err := h.campaigns.Channels(r.Context(), tenant.ID, id, p)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	out := make([]channelBody, 0, len(list))
	for _, ch := range list {
		out = append(out, channelOf(ch))
	}
	writePage(w, out, p, total)
}

// DeleteChannel removes a channel of a campaign of the organization.
//
//	@Summary		Delete a channel of a campaign
//	@Description	Its links stay, outside every campaign, and keep the UTM parameters they already carry. Needs a JWT or an API key with the write scope.
//	@Tags			campaigns
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID		path	int	true	"Organization id"
//	@Param			campaignID	path	int	true	"Campaign id"
//	@Param			channelID	path	int	true	"Channel id"
//	@Success		204
//	@Failure		401	{object}	ErrorResponse
//	@Failure		403	{object}	ErrorResponse
//	@Failure		404	{object}	ErrorResponse
//	@Failure		429	{object}	ErrorResponse
//	@ID	deleteCampaignChannel
//	@Router			/orgs/{orgID}/campaigns/{campaignID}/channels/{channelID} [delete]
func (h *CampaignHandler) DeleteChannel(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	campaignID, ok := idParam(w, r, "campaignID")
	if !ok {
		return
	}
	channelID, ok := idParam(w, r, "channelID")
	if !ok {
		return
	}
	if err := h.campaigns.DeleteChannel(r.Context(), tenant.ID, campaignID, channelID); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// exportHeader is the first row of the export.
var exportHeader = []string{"link_id", "short_url", "origin_url", "channel", "clicks", "created_at"}

// Export answers the links of a campaign with their clicks as a CSV file.
//
//	@Summary		Export a campaign
//	@Description	A CSV file with one row per link of the campaign: link_id, short_url, origin_url, channel, clicks and created_at. clicks counts the clicks between from and to (YYYY-MM-DD, days of tz, both included); without them it counts every click. Needs a JWT or an API key with the read scope.
//	@Tags			campaigns
//	@Produce		text/csv
//	@Security		BearerAuth
//	@Param			orgID		path		int		true	"Organization id"
//	@Param			campaignID	path		int		true	"Campaign id"
//	@Param			from		query		string	false	"First day, YYYY-MM-DD, a day of tz (UTC when tz is omitted)"
//	@Param			to			query		string	false	"Last day, YYYY-MM-DD, a day of tz"
//	@Param			tz			query		string	false	"IANA time zone the days are counted in, e.g. America/Lima. UTC when omitted"
//	@Success		200			{file}		file
//	@Failure		400			{object}	ErrorResponse
//	@Failure		401			{object}	ErrorResponse
//	@Failure		403			{object}	ErrorResponse
//	@Failure		404			{object}	ErrorResponse
//	@Failure		429			{object}	ErrorResponse
//	@ID	exportCampaign
//	@Router			/orgs/{orgID}/campaigns/{campaignID}/export [get]
func (h *CampaignHandler) Export(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	id, ok := idParam(w, r, "campaignID")
	if !ok {
		return
	}
	from, ok := dateParam(w, r, "from")
	if !ok {
		return
	}
	to, ok := dateParam(w, r, "to")
	if !ok {
		return
	}
	loc, ok := timeZoneParam(w, r)
	if !ok {
		return
	}
	rows, err := h.campaigns.Export(r.Context(), tenant.ID, id, from, to, loc)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="campaign-`+strconv.FormatInt(id, 10)+`.csv"`)
	out := csv.NewWriter(w)
	_ = out.Write(exportHeader)
	for _, e := range rows {
		short := shortURL(h.baseURL, link.Link{Code: e.Code, DomainHost: e.DomainHost})
		_ = out.Write([]string{
			strconv.FormatInt(e.LinkID, 10), cell(short), cell(e.OriginURL), cell(e.Channel),
			strconv.FormatInt(e.Clicks, 10), formatTime(e.CreatedAt),
		})
	}
	out.Flush()
}

// cell keeps a spreadsheet from running a value as a formula: one that starts with =, +, - or @
// (or a tab or carriage return) gets a leading apostrophe.
func cell(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		return "'" + v
	}
	return v
}
