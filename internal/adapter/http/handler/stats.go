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
	LinkID    int64       `json:"link_id"`
	From      string      `json:"from"`
	To        string      `json:"to"`
	Total     int64       `json:"total"`
	Daily     []dayBody   `json:"daily"`
	Referrers []countBody `json:"referrers"`
	Countries []countBody `json:"countries"`
	Devices   []countBody `json:"devices"`
} // @name LinkStats

const dateLayout = "2006-01-02"

// Get answers the clicks of one link of the organization between ?from= and ?to= (YYYY-MM-DD,
// both included, UTC). Without them it covers the last 30 days.
//
//	@Summary		Click statistics of a link
//	@Description	Clicks per day, referrer, country and device between from and to. Without them it covers the last 30 days. Needs a JWT or an API key with the read scope.
//	@Tags			analytics
//	@Produce		json
//	@Security		BearerAuth
//	@Param			orgID	path		int		true	"Organization id"
//	@Param			linkID	path		int		true	"Link id"
//	@Param			from	query		string	false	"First day, YYYY-MM-DD (UTC)"
//	@Param			to		query		string	false	"Last day, YYYY-MM-DD (UTC)"
//	@Success		200		{object}	LinkStatsResponse
//	@Failure	400	{object}	ErrorResponse
//	@Failure	401	{object}	ErrorResponse
//	@Failure	403	{object}	ErrorResponse
//	@Failure	404	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
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
	st, err := h.stats.Stats(r.Context(), analytics.StatsQuery{TenantID: tenant.ID, LinkID: linkID, From: from, To: to})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	body := statsBody{
		LinkID: st.LinkID, From: st.From, To: st.To, Total: st.Total,
		Daily:     make([]dayBody, 0, len(st.Daily)),
		Referrers: counts(st.Referrers), Countries: counts(st.Countries), Devices: counts(st.Devices),
	}
	for _, d := range st.Daily {
		body.Daily = append(body.Daily, dayBody{Date: d.Date, Clicks: d.Clicks})
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
