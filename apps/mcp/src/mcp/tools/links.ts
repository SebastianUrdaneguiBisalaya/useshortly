import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { segment } from '../../api/client.js';
import { link, pageMeta } from '../../api/schemas.js';
import { guard, ok, type ToolContext } from './helpers.js';
import { oneLine } from './text.js';

type Link = z.output<typeof link>;

const organizationId = z.number().int().positive().describe('Organization id, from list_organizations.');

export const structuredLink = (l: Link) => ({
	id: l.id,
	code: l.code,
	short_url: l.short_url,
	origin_url: l.origin_url,
	domain_id: l.domain_id,
	campaign_id: l.campaign_id,
	channel_id: l.channel_id,
	campaign_name: l.campaign_name || null,
	channel_name: l.channel_name || null,
	expires_at: l.expires_at,
	max_clicks: l.max_clicks,
	password_protected: l.protected,
	created_at: l.created_at,
});

export const describeLink = (l: Link) => {
	const notes = [
		l.channel_id !== null ? `campaign ${JSON.stringify(oneLine(l.campaign_name, 60))}, channel ${JSON.stringify(oneLine(l.channel_name, 40))}` : null,
		l.protected ? 'password protected' : null,
		l.expires_at ? `expires ${l.expires_at}` : null,
		l.max_clicks !== null ? `max ${l.max_clicks} clicks` : null,
	].filter(Boolean);
	return `- id ${l.id}: ${l.short_url} -> ${oneLine(l.origin_url)}${notes.length ? ` (${notes.join(', ')})` : ''}`;
};

export function registerListLinks(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'list_links',
		{
			title: 'List links',
			description:
				'Lists the short links of an organization, newest first, with the campaign and channel each was shared in. Use campaign_id or channel_id to list only the links of one campaign or channel. Use limit and offset to page through them: the result says whether more remain.',
			inputSchema: z.object({
				organization_id: organizationId,
				limit: z.number().int().min(1).max(100).default(20).describe('How many links to return (1 to 100).'),
				offset: z.number().int().min(0).default(0).describe('How many links to skip.'),
				campaign_id: z.number().int().positive().optional().describe('Only links in a channel of this campaign, from list_campaigns.'),
				channel_id: z.number().int().positive().optional().describe('Only links in this channel, from list_campaign_channels.'),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, limit, offset, campaign_id, channel_id }) =>
			guard(async () => {
				const { data, meta } = await api.get(`/orgs/${segment(organization_id)}/links`, z.array(link), {
					query: { limit, offset: offset || undefined, campaign_id, channel_id },
				});
				const page = pageMeta.safeParse(meta);
				const total = page.success ? page.data.total : data.length;
				const nextOffset = offset + data.length < total ? offset + data.length : null;

				const links = data.map(structuredLink);
				const lines = data.map(describeLink);
				const summary = data.length
					? `Showing ${offset + 1}-${offset + data.length} of ${total} links.${nextOffset !== null ? ` Use offset ${nextOffset} for the next page.` : ''}`
					: total === 0
						? 'This organization has no links yet.'
						: `No links at offset ${offset}: the organization has ${total}.`;
				return ok([summary, ...lines].join('\n'), { links, total, limit, offset, next_offset: nextOffset });
			})
	);
}

export function registerGetLink(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'get_link',
		{
			title: 'Get a link',
			description: 'Returns one short link of an organization by its id: where it points, its limits and whether it is password protected. Use list_links to find the link id.',
			inputSchema: z.object({
				organization_id: organizationId,
				link_id: z.number().int().positive().describe('Link id, from list_links.'),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, link_id }) =>
			guard(async () => {
				const { data } = await api.get(`/orgs/${segment(organization_id)}/links/${segment(link_id)}`, link);
				return ok(describeLink(data), { link: structuredLink(data) });
			})
	);
}
