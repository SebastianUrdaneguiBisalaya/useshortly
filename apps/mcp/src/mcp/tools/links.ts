import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { segment } from '../../api/client.js';
import { link, pageMeta } from '../../api/schemas.js';
import { guard, ok, type ToolContext } from './helpers.js';
import { oneLine } from './text.js';

const organizationId = z.number().int().positive().describe('Organization id, from list_organizations.');

export function registerListLinks(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'list_links',
		{
			title: 'List links',
			description: 'Lists the short links of an organization, newest first. Use limit and offset to page through them: the result says whether more remain.',
			inputSchema: z.object({
				organization_id: organizationId,
				limit: z.number().int().min(1).max(100).default(20).describe('How many links to return (1 to 100).'),
				offset: z.number().int().min(0).default(0).describe('How many links to skip.'),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, limit, offset }) =>
			guard(async () => {
				const { data, meta } = await api.get(`/orgs/${segment(organization_id)}/links`, z.array(link), {
					query: { limit, offset: offset || undefined },
				});
				const page = pageMeta.safeParse(meta);
				const total = page.success ? page.data.total : data.length;
				const nextOffset = offset + data.length < total ? offset + data.length : null;

				const links = data.map(l => ({
					id: l.id,
					code: l.code,
					short_url: l.short_url,
					origin_url: l.origin_url,
					domain_id: l.domain_id,
					expires_at: l.expires_at,
					max_clicks: l.max_clicks,
					password_protected: l.protected,
					created_at: l.created_at,
				}));

				const lines = data.map(l => {
					const notes = [l.protected ? 'password protected' : null, l.expires_at ? `expires ${l.expires_at}` : null, l.max_clicks !== null ? `max ${l.max_clicks} clicks` : null].filter(
						Boolean
					);
					return `- id ${l.id}: ${l.short_url} -> ${oneLine(l.origin_url)}${notes.length ? ` (${notes.join(', ')})` : ''}`;
				});
				const summary = data.length
					? `Showing ${offset + 1}-${offset + data.length} of ${total} links.${nextOffset !== null ? ` Use offset ${nextOffset} for the next page.` : ''}`
					: total === 0
						? 'This organization has no links yet.'
						: `No links at offset ${offset}: the organization has ${total}.`;
				return ok([summary, ...lines].join('\n'), { links, total, limit, offset, next_offset: nextOffset });
			})
	);
}
