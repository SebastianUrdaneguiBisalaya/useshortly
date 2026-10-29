package link

import (
	"net/url"
	"strings"
)

// utmMedium is the utm_medium of every link in a campaign.
const utmMedium = "useshortly"

// withUTM returns rawURL tagged for a campaign: utm_source is the channel, utm_medium is
// useshortly and utm_campaign is the campaign. Those three replace any value the URL already had;
// every other query parameter, in its order, and the fragment stay as they were.
func withUTM(rawURL, campaign, channel string) string {
	rest, fragment := cutFragment(rawURL)
	base, query, _ := strings.Cut(rest, "?")
	kept := dropUTM(query)
	kept = append(kept,
		"utm_source="+url.QueryEscape(channel),
		"utm_medium="+utmMedium,
		"utm_campaign="+url.QueryEscape(campaign))
	return base + "?" + strings.Join(kept, "&") + fragment
}

// withoutUTM returns rawURL without the three parameters withUTM sets.
func withoutUTM(rawURL string) string {
	rest, fragment := cutFragment(rawURL)
	base, query, hasQuery := strings.Cut(rest, "?")
	if !hasQuery {
		return rawURL
	}
	kept := dropUTM(query)
	if len(kept) == 0 {
		return base + fragment
	}
	return base + "?" + strings.Join(kept, "&") + fragment
}

// cutFragment splits "#fragment" (kept with its #) off the URL.
func cutFragment(rawURL string) (rest, fragment string) {
	if i := strings.IndexByte(rawURL, '#'); i >= 0 {
		return rawURL[:i], rawURL[i:]
	}
	return rawURL, ""
}

// dropUTM lists the pairs of a raw query that are not utm_source, utm_medium or utm_campaign,
// verbatim and in order.
func dropUTM(query string) []string {
	var kept []string
	for pair := range strings.SplitSeq(query, "&") {
		if pair == "" {
			continue
		}
		key, _, _ := strings.Cut(pair, "=")
		if k, err := url.QueryUnescape(key); err == nil {
			switch k {
			case "utm_source", "utm_medium", "utm_campaign":
				continue
			}
		}
		kept = append(kept, pair)
	}
	return kept
}
