package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/campaign"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
)

// channels knows one channel: id 1 is "Instagram" of "Black Friday".
type channels struct{}

func (channels) Resolve(_ context.Context, _, channelID int64) (string, string, error) {
	if channelID != 1 {
		return "", "", campaign.ErrChannelNotFound
	}
	return "Black Friday", "Instagram", nil
}

func newCampaignLinkHandler(repo *fakeLinkRepo, withChannels bool) *LinkHandler {
	s := link.NewService(repo, unusedGen{}, fakeHasher{}, nil)
	if withChannels {
		s = s.WithChannels(channels{})
	}
	return NewLinkHandler(s, nil, "http://x", false)
}

func TestCreateLinkInChannel(t *testing.T) {
	repo := &fakeLinkRepo{links: map[string]link.Link{}}
	h := newCampaignLinkHandler(repo, true)

	t.Run("tags the destination and answers with the channel", func(t *testing.T) {
		rec := createLink(t, h, `{"url":"https://example.com/a","alias":"promo","channel_id":1}`)
		require.Equal(t, http.StatusCreated, rec.Code)
		assert.Contains(t, rec.Body.String(), `"channel_id":1`)
		var body struct {
			Data struct {
				OriginURL string `json:"origin_url"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		assert.Equal(t, "https://example.com/a?utm_source=Instagram&utm_medium=useshortly&utm_campaign=Black+Friday", body.Data.OriginURL)
	})

	t.Run("an unknown channel is a 404", func(t *testing.T) {
		rec := createLink(t, h, `{"url":"https://example.com/a","alias":"other","channel_id":9}`)
		assert.Equal(t, http.StatusNotFound, rec.Code)
		assert.Contains(t, rec.Body.String(), "channel_not_found")
	})

	t.Run("a destination too long for the parameters is a 400", func(t *testing.T) {
		rec := createLink(t, h, `{"url":"https://example.com/`+strings.Repeat("a", 200)+`","alias":"long","channel_id":1}`)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, rec.Body.String(), "campaign_url_too_long")
	})

	t.Run("a link without a channel answers null", func(t *testing.T) {
		rec := createLink(t, h, `{"url":"https://example.com/b","alias":"plain"}`)
		require.Equal(t, http.StatusCreated, rec.Code)
		assert.Contains(t, rec.Body.String(), `"channel_id":null`)
		assert.Contains(t, rec.Body.String(), `"campaign_id":null`)
	})

	t.Run("campaigns not enabled is a 400", func(t *testing.T) {
		off := newCampaignLinkHandler(&fakeLinkRepo{links: map[string]link.Link{}}, false)
		rec := createLink(t, off, `{"url":"https://example.com/a","channel_id":1}`)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, rec.Body.String(), "campaigns_disabled")
	})
}

func setChannel(h *LinkHandler, linkID, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = mux.SetURLVars(req.WithContext(WithTenant(req.Context(), Tenant{ID: 1})), map[string]string{"linkID": linkID})
	rec := httptest.NewRecorder()
	h.SetChannel(rec, req)
	return rec
}

func TestSetLinkChannel(t *testing.T) {
	repo := &fakeLinkRepo{links: map[string]link.Link{}}
	h := newCampaignLinkHandler(repo, true)
	require.Equal(t, http.StatusCreated, createLink(t, h, `{"url":"https://example.com/a","alias":"promo"}`).Code)

	rec := setChannel(h, "1", `{"channel_id":1}`)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"channel_id":1`)
	assert.Contains(t, rec.Body.String(), "utm_source=Instagram")

	rec = setChannel(h, "1", `{"channel_id":null}`)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"channel_id":null`)
	assert.Contains(t, rec.Body.String(), `"origin_url":"https://example.com/a"`)

	assert.Equal(t, http.StatusNotFound, setChannel(h, "1", `{"channel_id":9}`).Code)
	assert.Equal(t, http.StatusNotFound, setChannel(h, "99", `{"channel_id":1}`).Code, "unknown link")
	assert.Equal(t, http.StatusNotFound, setChannel(h, "x", `{}`).Code, "bad id")
	assert.Equal(t, http.StatusBadRequest, setChannel(h, "1", `{"channel":1}`).Code, "unknown field")
}

func TestListLinksFilters(t *testing.T) {
	repo := &fakeLinkRepo{links: map[string]link.Link{}}
	one, two := int64(1), int64(2)
	repo.links["a"] = link.Link{ID: 1, Code: "a", TenantID: 1, ChannelID: &one, CampaignID: &one}
	repo.links["b"] = link.Link{ID: 2, Code: "b", TenantID: 1, ChannelID: &two, CampaignID: &one}
	repo.links["c"] = link.Link{ID: 3, Code: "c", TenantID: 1}
	h := newCampaignLinkHandler(repo, true)

	list := func(query string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/?"+query, nil)
		req = req.WithContext(WithTenant(req.Context(), Tenant{ID: 1}))
		rec := httptest.NewRecorder()
		h.List(rec, req)
		return rec
	}

	assert.Contains(t, list("").Body.String(), `"total":3`)
	assert.Contains(t, list("campaign_id=1").Body.String(), `"total":2`)
	rec := list("channel_id=2")
	assert.Contains(t, rec.Body.String(), `"total":1`)
	assert.Contains(t, rec.Body.String(), `"code":"b"`)
	assert.Contains(t, list("campaign_id=1&channel_id=2").Body.String(), `"total":1`)
	for _, bad := range []string{"campaign_id=x", "channel_id=0", "channel_id=-1"} {
		rec := list(bad)
		assert.Equal(t, http.StatusBadRequest, rec.Code, bad)
		assert.Contains(t, rec.Body.String(), "invalid_filter")
	}
}
