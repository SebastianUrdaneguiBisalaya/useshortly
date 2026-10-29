package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// idNum is an id as the tests carry it (a string) in the number a request body needs.
func idNum(t *testing.T, id string) int64 {
	t.Helper()
	n, err := strconv.ParseInt(id, 10, 64)
	require.NoError(t, err)
	return n
}

// idStr is an id read out of a decoded JSON body.
func idStr(v any) string {
	f, ok := v.(float64)
	if !ok {
		return ""
	}
	return strconv.FormatInt(int64(f), 10)
}

func TestCampaignsFromCreationToExport(t *testing.T) {
	e := newEnv(t, false)
	ana := e.signUp("ana@example.com", "Ana")
	acme := e.createOrg(ana, "Acme")
	org := "/api/v1/orgs/" + acme

	res := e.do("POST", org+"/campaigns", ana, map[string]string{"name": "Black Friday", "description": "Sale links"})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	campaignID := res.id()
	campaign := org + "/campaigns/" + campaignID
	assert.Equal(t, "Black Friday", res.str("name"))
	assert.EqualValues(t, 0, res.body["channel_count"])

	assert.Equal(t, "name_taken", e.do("POST", org+"/campaigns", ana, map[string]string{"name": "black friday"}).errCode())
	assert.Equal(t, "invalid_name", e.do("POST", org+"/campaigns", ana, map[string]string{"name": "  "}).errCode())

	res = e.do("POST", campaign+"/channels", ana, map[string]string{"name": "Instagram"})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	insta := res.id()
	res = e.do("POST", campaign+"/channels", ana, map[string]string{"name": "Email"})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	mail := res.id()
	assert.Equal(t, "name_taken", e.do("POST", campaign+"/channels", ana, map[string]string{"name": "EMAIL"}).errCode())

	res = e.do("GET", campaign+"/channels", ana, nil)
	require.Equal(t, http.StatusOK, res.status, res.raw)
	assert.Contains(t, res.raw, `"Instagram"`)
	assert.Contains(t, res.raw, `"Email"`)

	res = e.do("POST", org+"/links", ana, map[string]any{"url": "https://example.com/sale?ref=1", "alias": "bf-insta", "channel_id": idNum(t, insta)})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	instaLink := res.id()
	assert.Equal(t, "https://example.com/sale?ref=1&utm_source=Instagram&utm_medium=useshortly&utm_campaign=Black+Friday", res.str("origin_url"))
	assert.Equal(t, campaignID, idStr(res.body["campaign_id"]))
	assert.Equal(t, insta, idStr(res.body["channel_id"]))
	assert.Equal(t, "Black Friday", res.str("campaign_name"))
	assert.Equal(t, "Instagram", res.str("channel_name"))

	redirect := e.do("GET", "/bf-insta", "", nil)
	assert.Equal(t, http.StatusFound, redirect.status)
	loc, err := url.Parse(redirect.header.Get("Location"))
	require.NoError(t, err)
	assert.Equal(t, "Instagram", loc.Query().Get("utm_source"))
	assert.Equal(t, "Black Friday", loc.Query().Get("utm_campaign"))
	assert.Equal(t, "1", loc.Query().Get("ref"), "the destination's own parameters stay")

	res = e.do("POST", org+"/links", ana, map[string]any{"url": "https://example.com/sale", "alias": "bf-email", "channel_id": idNum(t, mail)})
	require.Equal(t, http.StatusCreated, res.status, res.raw)
	e.do("POST", org+"/links", ana, map[string]string{"url": "https://example.com/other", "alias": "no-campaign"})

	t.Run("the list filters by campaign and channel", func(t *testing.T) {
		res := e.do("GET", org+"/links?campaign_id="+campaignID, ana, nil)
		require.Equal(t, http.StatusOK, res.status, res.raw)
		assert.Contains(t, res.raw, "bf-insta")
		assert.Contains(t, res.raw, "bf-email")
		assert.NotContains(t, res.raw, "no-campaign")
		assert.Contains(t, res.raw, `"campaign_name":"Black Friday"`, "a list names the campaign and channel of each link")
		assert.Contains(t, res.raw, `"channel_name":"Instagram"`)
		res = e.do("GET", org+"/links?channel_id="+mail, ana, nil)
		assert.NotContains(t, res.raw, "bf-insta")
		assert.Contains(t, res.raw, "bf-email")
		assert.Equal(t, "invalid_filter", e.do("GET", org+"/links?campaign_id=abc", ana, nil).errCode())
	})

	t.Run("the campaign counts its channels and links", func(t *testing.T) {
		res := e.do("GET", campaign, ana, nil)
		require.Equal(t, http.StatusOK, res.status, res.raw)
		assert.EqualValues(t, 2, res.body["channel_count"])
		assert.EqualValues(t, 2, res.body["link_count"])
	})

	// The redirect checked above was the first Instagram click; these are two more and one by email.
	for _, code := range []string{"bf-insta", "bf-insta", "bf-email"} {
		require.Equal(t, http.StatusFound, e.do("GET", "/"+code, "", nil).status)
	}
	require.NoError(t, e.app.clicks.Close(context.Background()))

	t.Run("stats add up the clicks of every channel", func(t *testing.T) {
		res := e.do("GET", campaign+"/stats", ana, nil)
		require.Equal(t, http.StatusOK, res.status, res.raw)
		assert.EqualValues(t, 4, res.body["total"])
		channels := res.body["channels"].([]any)
		require.Len(t, channels, 2)
		first, second := channels[0].(map[string]any), channels[1].(map[string]any)
		assert.Equal(t, "Instagram", first["name"])
		assert.EqualValues(t, 3, first["clicks"])
		assert.Equal(t, "Email", second["name"])
		assert.EqualValues(t, 1, second["clicks"])
		assert.Equal(t, "invalid_range", e.do("GET", campaign+"/stats?from=2026-03-05&to=2026-03-01", ana, nil).errCode())
	})

	t.Run("the export is a CSV with a row per link", func(t *testing.T) {
		req := httptest.NewRequest("GET", campaign+"/export", nil)
		req.Header.Set("Authorization", "Bearer "+ana)
		rec := httptest.NewRecorder()
		e.app.handler.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "text/csv; charset=utf-8", rec.Header().Get("Content-Type"))
		assert.Contains(t, rec.Header().Get("Content-Disposition"), "campaign-"+campaignID+".csv")
		lines := strings.Split(strings.TrimSpace(rec.Body.String()), "\n")
		require.Len(t, lines, 3, rec.Body.String())
		assert.Equal(t, "link_id,short_url,origin_url,channel,clicks,created_at", lines[0])
		assert.Contains(t, lines[1], "http://short.test/bf-insta")
		assert.Contains(t, lines[1], ",Instagram,3,")
		assert.Contains(t, lines[2], ",Email,1,")
		assert.Equal(t, "invalid_range", e.do("GET", campaign+"/export?from=yesterday", ana, nil).errCode())
	})

	t.Run("a link moves to another channel and out of the campaign", func(t *testing.T) {
		res := e.do("PUT", org+"/links/"+instaLink+"/channel", ana, map[string]any{"channel_id": idNum(t, mail)})
		require.Equal(t, http.StatusOK, res.status, res.raw)
		assert.Equal(t, "https://example.com/sale?ref=1&utm_source=Email&utm_medium=useshortly&utm_campaign=Black+Friday", res.str("origin_url"))
		loc, err := url.Parse(e.do("GET", "/bf-insta", "", nil).header.Get("Location"))
		require.NoError(t, err)
		assert.Equal(t, "Email", loc.Query().Get("utm_source"), "the redirect follows the new destination")

		res = e.do("PUT", org+"/links/"+instaLink+"/channel", ana, `{"channel_id":null}`)
		require.Equal(t, http.StatusOK, res.status, res.raw)
		assert.Equal(t, "https://example.com/sale?ref=1", res.str("origin_url"))
		assert.Nil(t, res.body["channel_id"])
		assert.Nil(t, res.body["campaign_id"])
		assert.Equal(t, "https://example.com/sale?ref=1", e.do("GET", "/bf-insta", "", nil).header.Get("Location"))

		assert.Equal(t, "channel_not_found", e.do("PUT", org+"/links/"+instaLink+"/channel", ana, map[string]any{"channel_id": 9999}).errCode())
	})

	t.Run("deleting a channel keeps its links outside the campaign", func(t *testing.T) {
		assert.Equal(t, http.StatusNoContent, e.do("DELETE", campaign+"/channels/"+mail, ana, nil).status)
		res := e.do("GET", org+"/links?campaign_id="+campaignID, ana, nil)
		assert.NotContains(t, res.raw, "bf-email")
		assert.Equal(t, http.StatusFound, e.do("GET", "/bf-email", "", nil).status, "the link still redirects")
		assert.Equal(t, "channel_not_found", e.do("DELETE", campaign+"/channels/"+mail, ana, nil).errCode())
	})

	t.Run("a campaign is renamed and deleted", func(t *testing.T) {
		res := e.do("PATCH", campaign, ana, map[string]string{"name": "BF 2026"})
		require.Equal(t, http.StatusOK, res.status, res.raw)
		assert.Equal(t, "BF 2026", res.str("name"))
		assert.Equal(t, "Sale links", res.str("description"))
		assert.Equal(t, http.StatusNoContent, e.do("DELETE", campaign, ana, nil).status)
		assert.Equal(t, http.StatusNotFound, e.do("GET", campaign, ana, nil).status)
		assert.Equal(t, http.StatusNotFound, e.do("GET", campaign+"/stats", ana, nil).status)
		assert.Equal(t, http.StatusNotFound, e.do("GET", campaign+"/export", ana, nil).status)
	})
}

func TestCampaignsAreIsolatedAndScoped(t *testing.T) {
	e := newEnv(t, false)
	ana := e.signUp("ana@example.com", "Ana")
	bob := e.signUp("bob@example.com", "Bob")
	acme := e.createOrg(ana, "Acme")
	bobs := e.createOrg(bob, "Bobs")
	anaOrg, bobOrg := "/api/v1/orgs/"+acme, "/api/v1/orgs/"+bobs

	campaignID := e.do("POST", anaOrg+"/campaigns", ana, map[string]string{"name": "Launch"}).id()
	channelID := e.do("POST", anaOrg+"/campaigns/"+campaignID+"/channels", ana, map[string]string{"name": "Email"}).id()
	linkID := e.do("POST", bobOrg+"/links", bob, map[string]string{"url": "https://example.com/"}).id()

	t.Run("another organization's members are refused", func(t *testing.T) {
		for _, path := range []string{"/campaigns", "/campaigns/" + campaignID, "/campaigns/" + campaignID + "/stats", "/campaigns/" + campaignID + "/export"} {
			assert.Equal(t, "not_member", e.do("GET", anaOrg+path, bob, nil).errCode(), path)
		}
	})

	t.Run("an id from another organization looks unknown", func(t *testing.T) {
		for _, path := range []string{"/campaigns/" + campaignID, "/campaigns/" + campaignID + "/channels", "/campaigns/" + campaignID + "/stats", "/campaigns/" + campaignID + "/export"} {
			assert.Equal(t, http.StatusNotFound, e.do("GET", bobOrg+path, bob, nil).status, path)
		}
		assert.Equal(t, http.StatusNotFound, e.do("DELETE", bobOrg+"/campaigns/"+campaignID, bob, nil).status)
		assert.Equal(t, http.StatusNotFound, e.do("POST", bobOrg+"/campaigns/"+campaignID+"/channels", bob, map[string]string{"name": "x"}).status)
	})

	t.Run("a link cannot join another organization's channel", func(t *testing.T) {
		res := e.do("POST", bobOrg+"/links", bob, map[string]any{"url": "https://example.com/", "channel_id": idNum(t, channelID)})
		assert.Equal(t, http.StatusNotFound, res.status)
		assert.Equal(t, "channel_not_found", res.errCode())
		res = e.do("PUT", bobOrg+"/links/"+linkID+"/channel", bob, map[string]any{"channel_id": idNum(t, channelID)})
		assert.Equal(t, "channel_not_found", res.errCode())
	})

	t.Run("the same names can be used by another organization", func(t *testing.T) {
		assert.Equal(t, http.StatusCreated, e.do("POST", bobOrg+"/campaigns", bob, map[string]string{"name": "Launch"}).status)
	})

	t.Run("an API key needs the right scope", func(t *testing.T) {
		read := e.do("POST", anaOrg+"/api-keys", ana, map[string]string{"name": "r", "scope": "read"}).str("secret")
		assert.Equal(t, http.StatusOK, e.do("GET", anaOrg+"/campaigns", read, nil).status)
		assert.Equal(t, http.StatusOK, e.do("GET", anaOrg+"/campaigns/"+campaignID+"/stats", read, nil).status)
		assert.Equal(t, http.StatusOK, e.do("GET", anaOrg+"/campaigns/"+campaignID+"/export", read, nil).status)
		assert.Equal(t, http.StatusForbidden, e.do("POST", anaOrg+"/campaigns", read, map[string]string{"name": "x"}).status)
		assert.Equal(t, http.StatusForbidden, e.do("PATCH", anaOrg+"/campaigns/"+campaignID, read, map[string]string{"name": "x"}).status)
		assert.Equal(t, http.StatusForbidden, e.do("DELETE", anaOrg+"/campaigns/"+campaignID, read, nil).status)
		assert.Equal(t, http.StatusForbidden, e.do("PUT", anaOrg+"/links/1/channel", read, `{}`).status)
		write := e.do("POST", anaOrg+"/api-keys", ana, map[string]string{"name": "w", "scope": "write"}).str("secret")
		assert.Equal(t, http.StatusCreated, e.do("POST", anaOrg+"/campaigns", write, map[string]string{"name": "From a key"}).status)
	})

	t.Run("the CSV does not let a channel name run as a formula", func(t *testing.T) {
		c := e.do("POST", anaOrg+"/campaigns", ana, map[string]string{"name": "Sheets"}).id()
		ch := e.do("POST", anaOrg+"/campaigns/"+c+"/channels", ana, map[string]string{"name": "=HYPERLINK(1)"}).id()
		e.do("POST", anaOrg+"/links", ana, map[string]any{"url": "https://example.com/", "channel_id": idNum(t, ch)})
		req := httptest.NewRequest("GET", anaOrg+"/campaigns/"+c+"/export", nil)
		req.Header.Set("Authorization", "Bearer "+ana)
		rec := httptest.NewRecorder()
		e.app.handler.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)
		assert.Contains(t, rec.Body.String(), "'=HYPERLINK(1)")
	})
}
