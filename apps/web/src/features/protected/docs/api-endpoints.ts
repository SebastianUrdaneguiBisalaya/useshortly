export type Method = 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE';

export interface Field {
	description: string;
	name: string;
	required?: boolean;
	type: string;
}

export interface EndpointError {
	code: string;
	meaning: string;
	status: number;
}

export interface Endpoint {
	body?: Field[];
	/** JSON sent as the request body in the example. */
	bodyExample?: string;
	description: string;
	errors: EndpointError[];
	id: string;
	method: Method;
	/** Relative to `/orgs/{orgID}`. */
	path: string;
	query?: Field[];
	/** Query string of the example call, without the `?`. */
	queryExample?: string;
	/** JSON the example call returns, when it is short. */
	responseExample?: string;
	/** What a successful call returns, as a TypeScript type. */
	returns: string;
	scope: 'read' | 'write';
	status: number;
	title: string;
}

export interface EndpointGroup {
	description: string;
	endpoints: Endpoint[];
	id: string;
	title: string;
}

const LIMIT: Field = { description: 'Page size.', name: 'limit', type: 'number' };
const OFFSET: Field = { description: 'Items to skip.', name: 'offset', type: 'number' };
const PAGINATION = [LIMIT, OFFSET];
const BAD_PAGE: EndpointError = { code: 'invalid_pagination', meaning: 'limit and offset must be integers, limit at least 1 and offset at least 0.', status: 400 };

const LINK_EXAMPLE = `{
  "data": {
    "id": 42,
    "code": "summer1",
    "short_url": "https://short.example.com/summer1",
    "domain_id": null,
    "campaign_id": null,
    "channel_id": null,
    "campaign_name": "",
    "channel_name": "",
    "origin_url": "https://example.com/blog/summer-sale",
    "expires_at": null,
    "max_clicks": null,
    "protected": false,
    "qr_style": { "foreground": null, "background": null, "logo_url": null },
    "created_at": "2026-06-01T12:00:00Z"
  }
}`;

const CAMPAIGN_EXAMPLE = `{
  "data": {
    "id": 3,
    "name": "Black Friday",
    "description": "Links for the sale",
    "channel_count": 2,
    "link_count": 5,
    "created_at": "2026-06-01T12:00:00Z",
    "updated_at": null
  }
}`;

const CHANNEL_EXAMPLE = `{
  "data": {
    "id": 11,
    "campaign_id": 3,
    "name": "Instagram",
    "created_at": "2026-06-01T12:00:00Z"
  }
}`;

const INVALID_TIMEZONE: EndpointError = { code: 'invalid_timezone', meaning: 'tz is not an IANA time zone name such as America/Lima.', status: 400 };
const CAMPAIGN_NOT_FOUND: EndpointError = { code: 'not_found', meaning: 'The campaign does not exist or belongs to another organization.', status: 404 };
const NAME_ERRORS: EndpointError[] = [
	{ code: 'invalid_name', meaning: 'The name is empty, has control characters or is longer than the limit (100 characters for a campaign, 50 for a channel).', status: 400 },
	{ code: 'name_taken', meaning: 'The name is already used, ignoring case: by another campaign of the organization, or by another channel of the campaign.', status: 409 },
];

const DOMAIN_EXAMPLE = `{
  "data": {
    "id": 7,
    "host": "go.example.com",
    "verified": false,
    "verified_at": null,
    "verification": { "type": "TXT", "name": "_useshortly.go.example.com", "value": "useshortly-verify=…" },
    "created_at": "2026-06-01T12:00:00Z"
  }
}`;

const SET_PAGE_BODY: Field[] = [
	{ description: 'A full HTML document, at most 64 KB. A Go template: .Action (where the form posts to), .Error and .Code are available.', name: 'html', required: true, type: 'string' },
];
const PAGE_ERRORS: EndpointError[] = [{ code: 'invalid_html', meaning: 'The HTML is empty, larger than 64 KB, not a valid template, or its form does not post to {{.Action}}.', status: 400 }];

export const ENDPOINT_GROUPS: EndpointGroup[] = [
	{
		description: 'Create short links, read them and delete them. A link belongs to one organization.',
		endpoints: [
			{
				body: [
					{ description: 'The destination. http or https, at most 255 characters.', name: 'url', required: true, type: 'string' },
					{ description: '3 to 15 letters, digits, - or _. Not 7 characters long (that length is for generated codes). Random when empty.', name: 'alias', type: 'string' },
					{ description: 'RFC 3339 date in the future. The link stops working after it.', name: 'expires_at', type: 'string' },
					{ description: 'Greater than 0. The link stops working after this many clicks.', name: 'max_clicks', type: 'number' },
					{ description: '4 to 64 characters. Visitors must type it to open the link.', name: 'password', type: 'string' },
					{ description: 'A verified custom domain of the organization. The default host when omitted.', name: 'domain_id', type: 'number' },
					{
						description: 'A channel of one of the organization’s campaigns. The destination gets utm_source, utm_medium and utm_campaign added (see Using campaigns).',
						name: 'channel_id',
						type: 'number',
					},
				],
				bodyExample: `{
  "url": "https://example.com/blog/summer-sale",
  "alias": "summer1",
  "max_clicks": 1000
}`,
				description: 'Shortens a URL. Every field except url is optional.',
				errors: [
					{ code: 'invalid_url', meaning: 'The URL is not http(s) or is longer than 255 characters.', status: 400 },
					{ code: 'invalid_alias', meaning: 'The alias breaks the rules above or is a reserved word.', status: 400 },
					{ code: 'invalid_expiry', meaning: 'expires_at is not in the future.', status: 400 },
					{ code: 'invalid_max_clicks', meaning: 'max_clicks is not greater than 0.', status: 400 },
					{ code: 'invalid_password', meaning: 'The password is not 4 to 64 characters.', status: 400 },
					{ code: 'domain_not_verified', meaning: 'The domain is not yours or is not verified yet.', status: 409 },
					{ code: 'alias_taken', meaning: 'Another link already uses this alias.', status: 409 },
					{ code: 'channel_not_found', meaning: 'The channel does not exist or belongs to another organization.', status: 404 },
					{ code: 'campaign_url_too_long', meaning: 'The URL plus the campaign parameters is longer than 255 characters.', status: 400 },
				],
				id: 'create-link',
				method: 'POST',
				path: '/links',
				responseExample: LINK_EXAMPLE,
				returns: 'Envelope<Link>',
				scope: 'write',
				status: 201,
				title: 'Create a link',
			},
			{
				description: 'One page of the organization’s links, newest first.',
				errors: [BAD_PAGE, { code: 'invalid_filter', meaning: 'campaign_id or channel_id is not a positive integer.', status: 400 }],
				id: 'list-links',
				queryExample: 'limit=20&offset=0&campaign_id=3',
				method: 'GET',
				path: '/links',
				query: [
					...PAGINATION,
					{ description: 'Only links in a channel of this campaign.', name: 'campaign_id', type: 'number' },
					{ description: 'Only links in this channel.', name: 'channel_id', type: 'number' },
				],
				returns: 'Page<Link>',
				scope: 'read',
				status: 200,
				title: 'List links',
			},
			{
				description: 'One link of the organization.',
				errors: [{ code: 'not_found', meaning: 'The link does not exist or belongs to another organization.', status: 404 }],
				id: 'get-link',
				method: 'GET',
				path: '/links/{linkID}',
				responseExample: LINK_EXAMPLE,
				returns: 'Envelope<Link>',
				scope: 'read',
				status: 200,
				title: 'Get a link',
			},
			{
				description: 'Deletes the link and its click history. The short URL stops working at once.',
				errors: [{ code: 'not_found', meaning: 'The link does not exist or belongs to another organization.', status: 404 }],
				id: 'delete-link',
				method: 'DELETE',
				path: '/links/{linkID}',
				returns: 'void // 204, empty body',
				scope: 'write',
				status: 204,
				title: 'Delete a link',
			},
		],
		id: 'links',
		title: 'Links',
	},
	{
		description: 'A campaign groups the links you share for one initiative, split into channels such as Instagram or email. See Using campaigns for how links get their UTM parameters.',
		endpoints: [
			{
				body: [
					{ description: '1 to 100 characters. Unique in the organization, ignoring case.', name: 'name', required: true, type: 'string' },
					{ description: 'Up to 500 characters.', name: 'description', type: 'string' },
				],
				bodyExample: `{
  "name": "Black Friday",
  "description": "Links for the sale"
}`,
				description: 'Creates a campaign. It starts with no channels.',
				errors: [...NAME_ERRORS, { code: 'invalid_description', meaning: 'The description is longer than 500 characters.', status: 400 }],
				id: 'create-campaign',
				method: 'POST',
				path: '/campaigns',
				responseExample: CAMPAIGN_EXAMPLE,
				returns: 'Envelope<Campaign>',
				scope: 'write',
				status: 201,
				title: 'Create a campaign',
			},
			{
				description: 'One page of the organization’s campaigns, newest first, with how many channels and links each has.',
				errors: [BAD_PAGE],
				id: 'list-campaigns',
				method: 'GET',
				path: '/campaigns',
				query: PAGINATION,
				queryExample: 'limit=20&offset=0',
				returns: 'Page<Campaign>',
				scope: 'read',
				status: 200,
				title: 'List campaigns',
			},
			{
				description: 'One campaign of the organization.',
				errors: [CAMPAIGN_NOT_FOUND],
				id: 'get-campaign',
				method: 'GET',
				path: '/campaigns/{campaignID}',
				responseExample: CAMPAIGN_EXAMPLE,
				returns: 'Envelope<Campaign>',
				scope: 'read',
				status: 200,
				title: 'Get a campaign',
			},
			{
				body: [
					{ description: '1 to 100 characters. Unique in the organization, ignoring case.', name: 'name', type: 'string' },
					{ description: 'Up to 500 characters. Send an empty string to clear it.', name: 'description', type: 'string' },
				],
				bodyExample: `{
  "name": "BF 2026"
}`,
				description:
					'Changes the name and/or the description; a field you leave out stays as it is. Links already in the campaign keep the utm_campaign they were given, so a new name only reaches the links you put in its channels afterwards.',
				errors: [CAMPAIGN_NOT_FOUND, ...NAME_ERRORS, { code: 'invalid_description', meaning: 'The description is longer than 500 characters.', status: 400 }],
				id: 'update-campaign',
				method: 'PATCH',
				path: '/campaigns/{campaignID}',
				responseExample: CAMPAIGN_EXAMPLE,
				returns: 'Envelope<Campaign>',
				scope: 'write',
				status: 200,
				title: 'Update a campaign',
			},
			{
				description: 'Deletes the campaign and its channels. Its links stay and keep working, outside any campaign, and keep the UTM parameters they already have.',
				errors: [CAMPAIGN_NOT_FOUND],
				id: 'delete-campaign',
				method: 'DELETE',
				path: '/campaigns/{campaignID}',
				returns: 'void // 204, empty body',
				scope: 'write',
				status: 204,
				title: 'Delete a campaign',
			},
			{
				body: [{ description: '1 to 50 characters. Unique in the campaign, ignoring case. Becomes the utm_source of the links in the channel.', name: 'name', required: true, type: 'string' }],
				bodyExample: `{
  "name": "Instagram"
}`,
				description: 'Adds a channel to the campaign. A campaign has at most 100 channels.',
				errors: [CAMPAIGN_NOT_FOUND, ...NAME_ERRORS, { code: 'too_many_channels', meaning: 'The campaign already has 100 channels.', status: 409 }],
				id: 'create-channel',
				method: 'POST',
				path: '/campaigns/{campaignID}/channels',
				responseExample: CHANNEL_EXAMPLE,
				returns: 'Envelope<CampaignChannel>',
				scope: 'write',
				status: 201,
				title: 'Add a channel',
			},
			{
				description: 'One page of the campaign’s channels, oldest first.',
				errors: [BAD_PAGE, CAMPAIGN_NOT_FOUND],
				id: 'list-channels',
				method: 'GET',
				path: '/campaigns/{campaignID}/channels',
				query: PAGINATION,
				queryExample: 'limit=100',
				returns: 'Page<CampaignChannel>',
				scope: 'read',
				status: 200,
				title: 'List channels',
			},
			{
				description: 'Deletes the channel. Its links stay and keep working, outside any campaign, and keep the UTM parameters they already have.',
				errors: [{ code: 'channel_not_found', meaning: 'The channel does not exist in this campaign.', status: 404 }],
				id: 'delete-channel',
				method: 'DELETE',
				path: '/campaigns/{campaignID}/channels/{channelID}',
				returns: 'void // 204, empty body',
				scope: 'write',
				status: 204,
				title: 'Delete a channel',
			},
			{
				body: [{ description: 'The channel to put the link in. Leave it out, or send null, to take the link out of its campaign.', name: 'channel_id', type: 'number | null' }],
				bodyExample: `{
  "channel_id": 11
}`,
				description:
					'Puts a link in a channel, or moves it to another one: its destination is rewritten with the channel’s UTM parameters. Without a channel_id it takes the link out of its campaign and removes utm_source, utm_medium and utm_campaign from the destination; a value the link had for them before it joined the campaign is not restored. The short code never changes, so the QR code keeps working.',
				errors: [
					{ code: 'not_found', meaning: 'The link does not exist or belongs to another organization.', status: 404 },
					{ code: 'channel_not_found', meaning: 'The channel does not exist or belongs to another organization.', status: 404 },
					{ code: 'campaign_url_too_long', meaning: 'The destination plus the campaign parameters is longer than 255 characters.', status: 400 },
				],
				id: 'set-link-channel',
				method: 'PUT',
				path: '/links/{linkID}/channel',
				returns: 'Envelope<Link>',
				scope: 'write',
				status: 200,
				title: 'Put a link in a channel',
			},
			{
				description:
					'Clicks on every link in the campaign’s channels, per day, hour, weekday, country, device and referrer, the total of the previous period of the same length, and the clicks of each channel. Without from and to it covers the last 30 days; the longest period is 366 days.',
				errors: [CAMPAIGN_NOT_FOUND, { code: 'invalid_range', meaning: 'from is after to, or the period is longer than 366 days.', status: 400 }, INVALID_TIMEZONE],
				id: 'get-campaign-stats',
				method: 'GET',
				path: '/campaigns/{campaignID}/stats',
				query: [
					{ description: 'First day, YYYY-MM-DD, a day of tz (UTC when tz is omitted).', name: 'from', type: 'string' },
					{ description: 'Last day, YYYY-MM-DD, a day of tz.', name: 'to', type: 'string' },
					{ description: 'IANA time zone the days, hours and weekdays are counted in, such as America/Lima. UTC when omitted.', name: 'tz', type: 'string' },
					{ description: 'Only clicks from this country (ISO 3166-1 alpha-2), or unknown.', name: 'country', type: 'string' },
					{ description: 'mobile, tablet, desktop, bot or unknown.', name: 'device', type: 'string' },
					{ description: 'A referrer URL, or direct for none.', name: 'referrer', type: 'string' },
				],
				queryExample: 'from=2026-06-01&to=2026-06-30',
				returns: 'Envelope<CampaignStats>',
				scope: 'read',
				status: 200,
				title: 'Get campaign statistics',
			},
			{
				description:
					'A CSV file, not JSON, with one row per link of the campaign: link_id, short_url, origin_url, channel, clicks and created_at. clicks counts the clicks between from and to; without them it counts every click.',
				errors: [CAMPAIGN_NOT_FOUND, { code: 'invalid_range', meaning: 'from or to is not a date, or from is after to.', status: 400 }, INVALID_TIMEZONE],
				id: 'export-campaign',
				method: 'GET',
				path: '/campaigns/{campaignID}/export',
				query: [
					{ description: 'First day, YYYY-MM-DD, a day of tz (UTC when tz is omitted).', name: 'from', type: 'string' },
					{ description: 'Last day, YYYY-MM-DD, a day of tz.', name: 'to', type: 'string' },
					{ description: 'IANA time zone the days, hours and weekdays are counted in, such as America/Lima. UTC when omitted.', name: 'tz', type: 'string' },
				],
				queryExample: 'from=2026-06-01&to=2026-06-30',
				returns: 'Blob // text/csv',
				scope: 'read',
				status: 200,
				title: 'Export a campaign',
			},
		],
		id: 'campaigns',
		title: 'Campaigns',
	},
	{
		description: 'Every link has a QR code of its short URL. Read the image, or change how it is drawn.',
		endpoints: [
			{
				description:
					'An image, not JSON: the QR code of the short URL, drawn with the link’s colors. The server does not draw the logo; clients that show it do so themselves from qr_style.logo_url.',
				errors: [
					{ code: 'invalid_format', meaning: 'format is not png or svg.', status: 400 },
					{ code: 'invalid_size', meaning: 'size is not a number between 64 and 1024.', status: 400 },
				],
				id: 'get-qr',
				queryExample: 'format=png&size=512',
				method: 'GET',
				path: '/links/{linkID}/qr',
				query: [
					{ description: 'png (default) or svg.', name: 'format', type: '"png" | "svg"' },
					{ description: 'Pixels on a side, 64 to 1024. Default 256.', name: 'size', type: 'number' },
				],
				returns: 'Blob // image/png or image/svg+xml',
				scope: 'read',
				status: 200,
				title: 'Get the QR code',
			},
			{
				body: [
					{ description: '#rrggbb. Must be darker than the background, with a contrast ratio of at least 3.', name: 'foreground', type: 'string' },
					{ description: '#rrggbb.', name: 'background', type: 'string' },
					{ description: 'An https image URL, at most 255 characters. Stored, never fetched.', name: 'logo_url', type: 'string' },
				],
				bodyExample: `{
  "foreground": "#102a43",
  "background": "#f0f4f8",
  "logo_url": "https://example.com/logo.png"
}`,
				description: 'Replaces the style of the QR code. A field you leave out goes back to its default, so send {} to reset everything.',
				errors: [
					{ code: 'invalid_qr_color', meaning: 'A color is not #rrggbb.', status: 400 },
					{ code: 'low_qr_contrast', meaning: 'The foreground is not darker than the background, or the contrast is below 3.', status: 400 },
					{ code: 'invalid_logo_url', meaning: 'The logo is not an https URL of at most 255 characters.', status: 400 },
					{ code: 'not_found', meaning: 'The link does not exist or belongs to another organization.', status: 404 },
				],
				id: 'set-qr-style',
				method: 'PUT',
				path: '/links/{linkID}/qr-style',
				returns: 'Envelope<Link>',
				scope: 'write',
				status: 200,
				title: 'Style the QR code',
			},
		],
		id: 'qr-codes',
		title: 'QR codes',
	},
	{
		description: 'Clicks are counted per day of the tz time zone (UTC when omitted). Every number can be narrowed to one country, device or referrer.',
		endpoints: [
			{
				description:
					'Clicks per day, hour, weekday, country, device and referrer, plus the total of the previous period of the same length. Without from and to it covers the last 30 days; the longest period is 366 days.',
				errors: [{ code: 'invalid_range', meaning: 'from is after to, or the period is longer than 366 days.', status: 400 }, INVALID_TIMEZONE],
				id: 'get-stats',
				queryExample: 'from=2026-06-01&to=2026-06-30&country=PE',
				method: 'GET',
				path: '/links/{linkID}/stats',
				query: [
					{ description: 'First day, YYYY-MM-DD, a day of tz (UTC when tz is omitted).', name: 'from', type: 'string' },
					{ description: 'Last day, YYYY-MM-DD, a day of tz.', name: 'to', type: 'string' },
					{ description: 'IANA time zone the days, hours and weekdays are counted in, such as America/Lima. UTC when omitted.', name: 'tz', type: 'string' },
					{ description: 'Only clicks from this country (ISO 3166-1 alpha-2), or unknown.', name: 'country', type: 'string' },
					{ description: 'mobile, tablet, desktop, bot or unknown.', name: 'device', type: 'string' },
					{ description: 'A referrer URL, or direct for none.', name: 'referrer', type: 'string' },
				],
				returns: 'Envelope<LinkStats>',
				scope: 'read',
				status: 200,
				title: 'Get click statistics',
			},
		],
		id: 'statistics',
		title: 'Statistics',
	},
	{
		description: 'Protected links show a page where visitors type the password. Set one page for the whole organization, or one per link.',
		endpoints: [
			{
				description: 'The page every protected link of the organization shows, unless the link has its own.',
				errors: [{ code: 'not_found', meaning: 'No custom page: the default one is shown.', status: 404 }],
				id: 'get-org-unlock-page',
				method: 'GET',
				path: '/unlock-page',
				returns: 'Envelope<UnlockPage>',
				scope: 'read',
				status: 200,
				title: 'Get the organization’s page',
			},
			{
				body: SET_PAGE_BODY,
				description: 'Sets the page for all protected links of the organization.',
				errors: PAGE_ERRORS,
				id: 'set-org-unlock-page',
				method: 'PUT',
				path: '/unlock-page',
				returns: 'Envelope<UnlockPage>',
				scope: 'write',
				status: 200,
				title: 'Set the organization’s page',
			},
			{
				description: 'Goes back to the default page.',
				errors: [],
				id: 'delete-org-unlock-page',
				method: 'DELETE',
				path: '/unlock-page',
				returns: 'void // 204, empty body',
				scope: 'write',
				status: 204,
				title: 'Delete the organization’s page',
			},
			{
				description: 'The page one link shows instead of the organization’s.',
				errors: [{ code: 'not_found', meaning: 'The link has no page of its own, or the link does not exist.', status: 404 }],
				id: 'get-link-unlock-page',
				method: 'GET',
				path: '/links/{linkID}/unlock-page',
				returns: 'Envelope<UnlockPage>',
				scope: 'read',
				status: 200,
				title: 'Get a link’s page',
			},
			{
				body: SET_PAGE_BODY,
				description: 'Sets the page of one link.',
				errors: [...PAGE_ERRORS, { code: 'not_found', meaning: 'The link does not exist or belongs to another organization.', status: 404 }],
				id: 'set-link-unlock-page',
				method: 'PUT',
				path: '/links/{linkID}/unlock-page',
				returns: 'Envelope<UnlockPage>',
				scope: 'write',
				status: 200,
				title: 'Set a link’s page',
			},
			{
				description: 'The link goes back to the organization’s page.',
				errors: [{ code: 'not_found', meaning: 'The link does not exist or belongs to another organization.', status: 404 }],
				id: 'delete-link-unlock-page',
				method: 'DELETE',
				path: '/links/{linkID}/unlock-page',
				returns: 'void // 204, empty body',
				scope: 'write',
				status: 204,
				title: 'Delete a link’s page',
			},
			{
				description: 'Who set or removed a page, and when. Newest first.',
				errors: [BAD_PAGE],
				id: 'unlock-page-history',
				queryExample: 'limit=20&offset=0',
				method: 'GET',
				path: '/unlock-page/history',
				query: PAGINATION,
				returns: 'Page<UnlockPageEvent>',
				scope: 'read',
				status: 200,
				title: 'Get the page history',
			},
		],
		id: 'unlock-pages',
		title: 'Unlock pages',
	},
	{
		description: 'Serve links from your own host. Add the domain, create the DNS TXT record it asks for, then verify it.',
		endpoints: [
			{
				body: [{ description: 'A host name such as go.example.com, at most 253 characters. Stored in lowercase.', name: 'host', required: true, type: 'string' }],
				bodyExample: `{
  "host": "go.example.com"
}`,
				description: 'Adds a domain and answers with the DNS TXT record to create.',
				errors: [
					{ code: 'invalid_host', meaning: 'The host is not a valid domain name.', status: 400 },
					{ code: 'host_taken', meaning: 'Another organization already uses this host.', status: 409 },
				],
				id: 'create-domain',
				method: 'POST',
				path: '/domains',
				responseExample: DOMAIN_EXAMPLE,
				returns: 'Envelope<Domain>',
				scope: 'write',
				status: 201,
				title: 'Add a domain',
			},
			{
				description: 'One page of the organization’s domains.',
				errors: [BAD_PAGE],
				id: 'list-domains',
				queryExample: 'limit=20&offset=0',
				method: 'GET',
				path: '/domains',
				query: PAGINATION,
				returns: 'Page<Domain>',
				scope: 'read',
				status: 200,
				title: 'List domains',
			},
			{
				description: 'One domain, with its DNS record while it is not verified.',
				errors: [{ code: 'not_found', meaning: 'The domain does not exist or belongs to another organization.', status: 404 }],
				id: 'get-domain',
				method: 'GET',
				path: '/domains/{domainID}',
				returns: 'Envelope<Domain>',
				scope: 'read',
				status: 200,
				title: 'Get a domain',
			},
			{
				description: 'Looks up the DNS TXT record and, if it is there, marks the domain as verified. Links can only use verified domains.',
				errors: [
					{ code: 'verification_failed', meaning: 'The record was not found or has another value. DNS can take a while to spread.', status: 422 },
					{ code: 'dns_unavailable', meaning: 'The DNS lookup failed. Try again.', status: 503 },
					{ code: 'not_found', meaning: 'The domain does not exist or belongs to another organization.', status: 404 },
				],
				id: 'verify-domain',
				method: 'POST',
				path: '/domains/{domainID}/verify',
				returns: 'Envelope<Domain>',
				scope: 'write',
				status: 200,
				title: 'Verify a domain',
			},
			{
				description: 'Deletes the domain and every link served from it.',
				errors: [{ code: 'not_found', meaning: 'The domain does not exist or belongs to another organization.', status: 404 }],
				id: 'delete-domain',
				method: 'DELETE',
				path: '/domains/{domainID}',
				returns: 'void // 204, empty body',
				scope: 'write',
				status: 204,
				title: 'Delete a domain',
			},
		],
		id: 'domains',
		title: 'Domains',
	},
];
