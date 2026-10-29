/** Longest destination the API accepts. */
export const MAX_DESTINATION_LENGTH = 255;

const UTM_KEYS = new Set(['utm_source', 'utm_medium', 'utm_campaign']);

/** Escapes a query value like the API does (Go's `url.QueryEscape`): spaces become `+` and only `A-Za-z0-9-_.~` stay as they are. */
function escapeQuery(value: string) {
	return encodeURIComponent(value)
		.replace(/%20/g, '+')
		.replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function isUtmKey(pair: string) {
	const key = pair.split('=', 1)[0] ?? '';
	try {
		return UTM_KEYS.has(decodeURIComponent(key.replace(/\+/g, ' ')));
	} catch {
		return false;
	}
}

/**
 * The destination a link gets when it is put in a campaign channel, as the API builds it: `utm_source` is the channel,
 * `utm_medium` is `useshortly` and `utm_campaign` is the campaign. Those three replace the ones the URL already had;
 * every other parameter, in its order, and the fragment stay.
 */
export function withUtm(rawUrl: string, campaign: string, channel: string) {
	const hash = rawUrl.indexOf('#');
	const fragment = hash >= 0 ? rawUrl.slice(hash) : '';
	const rest = hash >= 0 ? rawUrl.slice(0, hash) : rawUrl;
	const question = rest.indexOf('?');
	const base = question >= 0 ? rest.slice(0, question) : rest;
	const query = question >= 0 ? rest.slice(question + 1) : '';
	const kept = query.split('&').filter(pair => pair !== '' && !isUtmKey(pair));
	kept.push(`utm_source=${escapeQuery(channel)}`, 'utm_medium=useshortly', `utm_campaign=${escapeQuery(campaign)}`);
	return `${base}?${kept.join('&')}${fragment}`;
}
