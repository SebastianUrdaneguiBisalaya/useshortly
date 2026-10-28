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
		],
		name: 'list_links',
		returns: 'A page of links, with short URL, destination, limits and the total.',
	},
	{
		description: 'One link of an organization.',
		input: [ORG, LINK],
		name: 'get_link',
		returns: 'The link’s short URL, destination, expiration, click limit and whether it has a password.',
	},
	{
		description: 'Click statistics of a link, optionally narrowed to one country, device or referrer.',
		input: [
			ORG,
			LINK,
			{ description: 'First day to include, YYYY-MM-DD (UTC).', name: 'from', type: 'string' },
			{ description: 'Last day to include, YYYY-MM-DD (UTC). The period is at most 366 days; the default is the last 30.', name: 'to', type: 'string' },
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
			{ description: 'Days to cover, 1 to 90. Default 30.', name: 'days', type: 'string' },
		],
		name: 'link_performance_report',
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
