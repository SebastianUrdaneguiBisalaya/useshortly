package handler

import (
	"net/http"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
)

type StatsHandler struct {
	stats *analytics.Service
}

func NewStatsHandler(stats *analytics.Service) *StatsHandler {
	return &StatsHandler{stats: stats}
}

type countBody struct {
	Name   string `json:"name"`
	Clicks int64  `json:"clicks"`
} // @name ClickCount

type dayBody struct {
	Date   string `json:"date"`
	Clicks int64  `json:"clicks"`
} // @name DailyClicks

type statsBody struct {
	LinkID int64  `json:"link_id"`
	From   string `json:"from"`
	To     string `json:"to"`
	Total  int64  `json:"total"`
	// PreviousTotal is the clicks of the window right before this one, as long as it.
	PreviousTotal int64     `json:"previous_total"`
	Daily         []dayBody `json:"daily"`
	// ByHour has 24 entries (UTC hour 0..23) and ByWeekday 7 (0 is Sunday).
	ByHour    []int64     `json:"by_hour"`
	ByWeekday []int64     `json:"by_weekday"`
	Referrers []countBody `json:"referrers"`
	Countries []countBody `json:"countries"`
	Devices   []countBody `json:"devices"`
} // @name LinkStats

type channelCountBody struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Clicks int64  `json:"clicks"`
} // @name CampaignChannelClicks

type campaignStatsBody struct {
	CampaignID int64  `json:"campaign_id"`
	From       string `json:"from"`
	To         string `json:"to"`
	Total      int64  `json:"total"`
	// PreviousTotal is the clicks of the window right before this one, as long as it.
	PreviousTotal int64     `json:"previous_total"`
	Daily         []dayBody `json:"daily"`
	// ByHour has 24 entries (UTC hour 0..23) and ByWeekday 7 (0 is Sunday).
	ByHour    []int64     `json:"by_hour"`
	ByWeekday []int64     `json:"by_weekday"`
	Referrers []countBody `json:"referrers"`
	Countries []countBody `json:"countries"`
	Devices   []countBody `json:"devices"`
	// Channels lists every channel of the campaign, most clicks first, the ones without clicks included.
	Channels []channelCountBody `json:"channels"`
} // @name CampaignStats

const dateLayout = "2006-01-02"

// Get answers the clicks of one link of the organization between ?from= and ?to= (YYYY-MM-DD,
// both included, UTC). Without them it covers the last 30 days.
//
//	@Summary		Click statistics of a link
//	@Description	Clicks per day, hour, weekday, referrer, country and device between from and to, the total of the previous period of the same length, optionally narrowed to one country, device or referrer. Without dates it covers the last 30 days. Needs a JWT or an API key with the read scope.
//	@Tags			analytics
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int		true	"Organization id"
//	@Param			linkID	path		int		true	"Link id"
//	@Param			from	query		string	false	"First day, YYYY-MM-DD (UTC)"
//	@Param			to		query		string	false	"Last day, YYYY-MM-DD (UTC)"
//	@Param			country	query		string	false	"Only clicks from this country (ISO 3166-1 alpha-2), or unknown"
//	@Param			device	query		string	false	"Only clicks from this device (mobile, tablet, desktop, bot), or unknown"
//	@Param			referrer	query		string	false	"Only clicks with this referrer, or direct for none"
//	@Success		200		{object}	LinkStatsResponse
//	@Failure	400	{object}	ErrorResponse
//	@Failure	401	{object}	ErrorResponse
//	@Failure	403	{object}	ErrorResponse
//	@Failure	404	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@ID	getLinkStats
//	@Router			/orgs/{orgID}/links/{linkID}/stats [get]
func (h *StatsHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	linkID, ok := idParam(w, r, "linkID")
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
	q := r.URL.Query()
	st, err := h.stats.Stats(r.Context(), analytics.StatsQuery{TenantID: tenant.ID, LinkID: linkID, From: from, To: to,
		Country: q.Get("country"), Device: q.Get("device"), Referrer: q.Get("referrer")})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	body := statsBody{
		LinkID: st.LinkID, From: st.From, To: st.To, Total: st.Total, PreviousTotal: st.PreviousTotal, ByHour: st.ByHour, ByWeekday: st.ByWeekday,
		Daily:     make([]dayBody, 0, len(st.Daily)),
		Referrers: counts(st.Referrers), Countries: counts(st.Countries), Devices: counts(st.Devices),
	}
	for _, d := range st.Daily {
		body.Daily = append(body.Daily, dayBody{Date: d.Date, Clicks: d.Clicks})
	}
	writeData(w, http.StatusOK, body)
}

// GetCampaign answers the clicks of every link of one campaign of the organization between ?from=
// and ?to= (YYYY-MM-DD, both included, UTC). Without them it covers the last 30 days.
//
//	@Summary		Click statistics of a campaign
//	@Description	Clicks of all the links in the campaign's channels per day, hour, weekday, referrer, country and device, plus the clicks of each channel, between from and to, the total of the previous period of the same length, optionally narrowed to one country, device or referrer. Without dates it covers the last 30 days. Needs a JWT or an API key with the read scope.
//	@Tags			analytics
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID		path		int		true	"Organization id"
//	@Param			campaignID	path		int		true	"Campaign id"
//	@Param			from		query		string	false	"First day, YYYY-MM-DD (UTC)"
//	@Param			to			query		string	false	"Last day, YYYY-MM-DD (UTC)"
//	@Param			country		query		string	false	"Only clicks from this country (ISO 3166-1 alpha-2), or unknown"
//	@Param			device		query		string	false	"Only clicks from this device (mobile, tablet, desktop, bot), or unknown"
//	@Param			referrer	query		string	false	"Only clicks with this referrer, or direct for none"
//	@Success		200			{object}	CampaignStatsResponse
//	@Failure		400			{object}	ErrorResponse
//	@Failure		401			{object}	ErrorResponse
//	@Failure		403			{object}	ErrorResponse
//	@Failure		404			{object}	ErrorResponse
//	@Failure		429			{object}	ErrorResponse
//	@ID	getCampaignStats
//	@Router			/orgs/{orgID}/campaigns/{campaignID}/stats [get]
func (h *StatsHandler) GetCampaign(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	campaignID, ok := idParam(w, r, "campaignID")
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
	q := r.URL.Query()
	st, err := h.stats.CampaignStats(r.Context(), analytics.CampaignQuery{TenantID: tenant.ID, CampaignID: campaignID, From: from, To: to,
		Country: q.Get("country"), Device: q.Get("device"), Referrer: q.Get("referrer")})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	body := campaignStatsBody{
		CampaignID: st.CampaignID, From: st.From, To: st.To, Total: st.Total, PreviousTotal: st.PreviousTotal, ByHour: st.ByHour, ByWeekday: st.ByWeekday,
		Daily:     make([]dayBody, 0, len(st.Daily)),
		Referrers: counts(st.Referrers), Countries: counts(st.Countries), Devices: counts(st.Devices),
		Channels: make([]channelCountBody, 0, len(st.Channels)),
	}
	for _, d := range st.Daily {
		body.Daily = append(body.Daily, dayBody{Date: d.Date, Clicks: d.Clicks})
	}
	for _, c := range st.Channels {
		body.Channels = append(body.Channels, channelCountBody{ID: c.ID, Name: c.Name, Clicks: c.Clicks})
	}
	writeData(w, http.StatusOK, body)
}

func counts(in []analytics.Count) []countBody {
	out := make([]countBody, 0, len(in))
	for _, c := range in {
		out = append(out, countBody{Name: c.Name, Clicks: c.Clicks})
	}
	return out
}

// dateParam reads an optional YYYY-MM-DD query value; absent is the zero time.
func dateParam(w http.ResponseWriter, r *http.Request, name string) (time.Time, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return time.Time{}, true
	}
	t, err := time.Parse(dateLayout, raw)
	if err != nil {
		WriteAPIErrorDetails(w, http.StatusBadRequest, "invalid_range", "from and to must be dates like 2026-01-31",
			[]FieldError{{Field: name, Message: "expected YYYY-MM-DD"}})
		return time.Time{}, false
	}
	return t, true
}
