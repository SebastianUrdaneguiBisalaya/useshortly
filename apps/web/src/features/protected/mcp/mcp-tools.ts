import type { DocRow } from '../share/doc-parts';

export interface McpTool {
	description: string;
	/** What it takes, as the tool’s own input schema. */
	input: DocRow[];
	name: string;
	/** One line on what comes back. */
	returns: string;
	/** Needs the write scope: the tool does not exist on a read-only connection. */
	write?: boolean;
}

const ORG: DocRow = { description: 'Organization id, from list_organizations.', name: 'organization_id', required: true, type: 'number' };
const LINK: DocRow = { description: 'Link id, from list_links.', name: 'link_id', required: true, type: 'number' };
const CAMPAIGN: DocRow = { description: 'Campaign id, from list_campaigns.', name: 'campaign_id', required: true, type: 'number' };
const TZ_DESCRIPTION = 'IANA time zone the days, hours and weekdays are counted in, such as America/Lima. UTC when omitted.';
const PERIOD: DocRow[] = [
	{ description: 'First day to include, YYYY-MM-DD, a day of tz (UTC when tz is omitted).', name: 'from', type: 'string' },
	{ description: 'Last day to include, YYYY-MM-DD, a day of tz. The period is at most 366 days; the default is the last 30.', name: 'to', type: 'string' },
	{ description: TZ_DESCRIPTION, name: 'tz', type: 'string' },
	{ description: 'ISO 3166-1 alpha-2 code such as PE, or "unknown".', name: 'country', type: 'string' },
	{ description: 'mobile, tablet, desktop, bot or "unknown".', name: 'device', type: 'string' },
	{ description: 'A referrer exactly as listed, or "direct" for none.', name: 'referrer', type: 'string' },
];

export const MCP_TOOLS: McpTool[] = [
	{
		description: 'The account the connection acts for, and whether the connection is read-only.',
		input: [],
		name: 'whoami',
		returns: 'The user’s id, email and name, and the granted scope.',
	},
	{
		description: 'The organizations of the user. Call it first: every other tool needs an organization id.',
		input: [],
		name: 'list_organizations',
		returns: 'Each organization’s id, name and description.',
	},
	{
		description: 'The links of an organization, newest first.',
		input: [
			ORG,
			{ description: 'How many links to return, 1 to 100. Default 20.', name: 'limit', type: 'number' },
			{ description: 'How many links to skip. Default 0.', name: 'offset', type: 'number' },
			{ description: 'Only links in a channel of this campaign, from list_campaigns.', name: 'campaign_id', type: 'number' },
			{ description: 'Only links in this channel, from list_campaign_channels.', name: 'channel_id', type: 'number' },
		],
		name: 'list_links',
		returns: 'A page of links, with short URL, destination, limits, the campaign and channel each was shared in, and the total.',
	},
	{
		description: 'One link of an organization.',
		input: [ORG, LINK],
		name: 'get_link',
		returns: 'The link’s short URL, destination, expiration, click limit, whether it has a password, and its campaign and channel.',
	},
	{
		description: 'Click statistics of a link, optionally narrowed to one country, device or referrer.',
		input: [
			ORG,
			LINK,
			{ description: 'First day to include, YYYY-MM-DD, a day of tz (UTC when tz is omitted).', name: 'from', type: 'string' },
			{ description: 'Last day to include, YYYY-MM-DD, a day of tz. The period is at most 366 days; the default is the last 30.', name: 'to', type: 'string' },
			{ description: TZ_DESCRIPTION, name: 'tz', type: 'string' },
			{ description: 'ISO 3166-1 alpha-2 code such as PE, or "unknown".', name: 'country', type: 'string' },
			{ description: 'mobile, tablet, desktop, bot or "unknown".', name: 'device', type: 'string' },
			{ description: 'A referrer exactly as listed, or "direct" for none.', name: 'referrer', type: 'string' },
		],
		name: 'get_link_stats',
		returns: 'Total and previous-period total, clicks per day, hour and weekday, and the top referrers, countries and devices.',
	},
	{
		description: 'The QR code of a link, as a PNG image the assistant can show.',
		input: [ORG, LINK, { description: 'Pixels on a side, 64 to 1024. Default 256.', name: 'size', type: 'number' }],
		name: 'get_link_qr',
		returns: 'A PNG image.',
	},
	{
		description: 'The campaigns of an organization, newest first. A campaign groups the links shared for one initiative, split into channels such as Instagram or email.',
		input: [
			ORG,
			{ description: 'How many campaigns to return, 1 to 100. Default 20.', name: 'limit', type: 'number' },
			{ description: 'How many campaigns to skip. Default 0.', name: 'offset', type: 'number' },
		],
		name: 'list_campaigns',
		returns: 'A page of campaigns, with how many channels and links each has, and the total.',
	},
	{
		description: 'One campaign of an organization.',
		input: [ORG, CAMPAIGN],
		name: 'get_campaign',
		returns: 'The campaign’s name, description and how many channels and links it has.',
	},
	{
		description: 'The channels of a campaign, oldest first. A channel is a place the campaign is shared; its name becomes the utm_source of its links.',
		input: [
			ORG,
			CAMPAIGN,
			{ description: 'How many channels to return, 1 to 100. Default 100.', name: 'limit', type: 'number' },
			{ description: 'How many channels to skip. Default 0.', name: 'offset', type: 'number' },
		],
		name: 'list_campaign_channels',
		returns: 'The channels with their ids, and the total.',
	},
	{
		description: 'Click statistics of a whole campaign, optionally narrowed to one country, device or referrer. Use it to compare how each channel performs.',
		input: [ORG, CAMPAIGN, ...PERIOD],
		name: 'get_campaign_stats',
		returns: 'Total and previous-period total, the clicks of each channel (channels without clicks included), clicks per day, hour and weekday, and the top referrers, countries and devices.',
	},
	{
		description: 'The custom domains of an organization and, for the ones not verified yet, the DNS record to create.',
		input: [ORG],
		name: 'list_domains',
		returns: 'Each domain’s host, verification state and DNS TXT record.',
	},
	{
		description: 'Shortens a URL.',
		input: [
			ORG,
			{ description: 'The long URL: http or https, at most 255 characters.', name: 'url', required: true, type: 'string' },
			{ description: '3 to 15 letters, digits, - or _, and not 7 characters long. Random when omitted.', name: 'alias', type: 'string' },
			{ description: 'ISO 8601 date-time with a time zone, in the future.', name: 'expires_at', type: 'string' },
			{ description: 'The link stops working after this many clicks.', name: 'max_clicks', type: 'number' },
			{ description: '4 to 64 characters. Visitors must type it.', name: 'password', type: 'string' },
			{ description: 'A verified custom domain of the organization, from list_domains.', name: 'domain_id', type: 'number' },
			{
				description: 'A campaign channel, from list_campaign_channels. The destination gets utm_source, utm_medium and utm_campaign added, and with them must fit in 255 characters.',
				name: 'channel_id',
				type: 'number',
			},
		],
		name: 'create_link',
		returns: 'The new link, with its short URL.',
		write: true,
	},
	{
		description: 'Deletes a link. Clients mark it as destructive and ask you before running it.',
		input: [ORG, LINK],
		name: 'delete_link',
		returns: 'A confirmation.',
		write: true,
	},
	{
		description: 'Creates a campaign. It starts with no channels: add them next.',
		input: [
			ORG,
			{ description: '1 to 100 characters. Unique in the organization, ignoring case.', name: 'name', required: true, type: 'string' },
			{ description: 'Up to 500 characters.', name: 'description', type: 'string' },
		],
		name: 'create_campaign',
		returns: 'The new campaign and its id.',
		write: true,
	},
	{
		description:
			'Changes the name and/or the description of a campaign. Links already in it keep the campaign name they were given; a new name only reaches the links put in its channels afterwards.',
		input: [
			ORG,
			CAMPAIGN,
			{ description: '1 to 100 characters. Unique in the organization, ignoring case.', name: 'name', type: 'string' },
			{ description: 'Up to 500 characters. An empty one clears it.', name: 'description', type: 'string' },
		],
		name: 'update_campaign',
		returns: 'The updated campaign.',
		write: true,
	},
	{
		description:
			'Permanently deletes a campaign and its channels. Its links stay and keep working, outside any campaign, with the UTM parameters they already have. Marked destructive, so your assistant asks first.',
		input: [ORG, CAMPAIGN],
		name: 'delete_campaign',
		returns: 'A confirmation.',
		write: true,
	},
	{
		description: 'Adds a channel to a campaign, such as Instagram or email. A campaign has at most 100 channels.',
		input: [
			ORG,
			CAMPAIGN,
			{ description: '1 to 50 characters. Unique in the campaign, ignoring case. It becomes the utm_source of the links put in the channel.', name: 'name', required: true, type: 'string' },
		],
		name: 'add_campaign_channel',
		returns: 'The new channel and its id.',
		write: true,
	},
	{
		description:
			'Permanently deletes a channel of a campaign. Its links stay and keep working, outside any campaign, with the UTM parameters they already have. Marked destructive, so your assistant asks first.',
		input: [ORG, CAMPAIGN, { description: 'Channel id, from list_campaign_channels.', name: 'channel_id', required: true, type: 'number' }],
		name: 'delete_campaign_channel',
		returns: 'A confirmation.',
		write: true,
	},
	{
		description:
			'Puts an existing link in a campaign channel, or moves it to another one: its destination is rewritten with the channel’s utm_source, utm_medium=useshortly and utm_campaign. Without a channel it takes the link out of its campaign and removes those three parameters; a value the link had for them before is not restored. The short code and the QR code do not change.',
		input: [ORG, LINK, { description: 'The channel to put the link in, from list_campaign_channels. Leave it out to take the link out of its campaign.', name: 'channel_id', type: 'number' }],
		name: 'set_link_channel',
		returns: 'The link with its new destination, campaign and channel.',
		write: true,
	},
	{
		description: 'Registers a custom domain and answers with the DNS TXT record to create.',
		input: [ORG, { description: 'A host name such as go.example.com.', name: 'host', required: true, type: 'string' }],
		name: 'add_domain',
		returns: 'The domain and its DNS record.',
		write: true,
	},
	{
		description: 'Checks the DNS record and, if it is there, verifies the domain.',
		input: [ORG, { description: 'Domain id, from list_domains.', name: 'domain_id', required: true, type: 'number' }],
		name: 'verify_domain',
		returns: 'The domain with its new state.',
		write: true,
	},
];

export const MCP_PROMPTS: { name: string; write?: boolean; description: string; input: DocRow[] }[] = [
	{
		description: 'A report on how the links of an organization performed: clicks, trend, best day, top countries, devices and referrers.',
		input: [
			{ description: 'Organization name or id. Asked when you have several and name none.', name: 'organization', type: 'string' },
			{ description: 'IANA time zone the days are counted in, such as America/Lima. UTC when omitted.', name: 'time_zone', type: 'string' },
			{ description: 'Days to cover, 1 to 90. Default 30.', name: 'days', type: 'string' },
		],
		name: 'link_performance_report',
	},
	{
		description:
			'A report comparing the channels of a campaign: which brought the most clicks, how the period compares with the previous one, the top referrers, countries and devices, and a recommendation.',
		input: [
			{ description: 'Organization name or id. Asked when you have several and name none.', name: 'organization', type: 'string' },
			{ description: 'Campaign name or id. Asked when you have several and name none.', name: 'campaign', type: 'string' },
			{ description: 'IANA time zone the days are counted in, such as America/Lima. UTC when omitted.', name: 'time_zone', type: 'string' },
			{ description: 'Days to cover, 1 to 90. Default 30.', name: 'days', type: 'string' },
		],
		name: 'campaign_performance_report',
	},
	{
		description: 'Shortens a URL, optionally with an alias, and offers a QR code afterwards.',
		input: [
			{ description: 'The URL to shorten. http or https.', name: 'url', required: true, type: 'string' },
			{ description: 'Custom short code, 3 to 15 letters, digits, - or _.', name: 'alias', type: 'string' },
			{ description: 'Organization name or id.', name: 'organization', type: 'string' },
		],
		name: 'shorten_url',
		write: true,
	},
];
