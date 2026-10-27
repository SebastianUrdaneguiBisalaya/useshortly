import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { segment } from '../../api/client.js';
import { link } from '../../api/schemas.js';
import { guard, ok, type ToolContext } from './helpers.js';
import { oneLine } from './text.js';

const organizationId = z.number().int().positive().describe('Organization id, from list_organizations.');

const destination = z
	.string()
	.max(255)
	.refine(v => /^https?:\/\/[^\s/]+/i.test(v), 'must be an http or https URL')
	.describe('The long URL to shorten: http or https, at most 255 characters.');

export function registerCreateLink(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'create_link',
		{
			title: 'Create a short link',
			description:
				'Shortens a URL in an organization and returns the short link. Optional settings: a custom alias, an expiration, a click limit, a password, or a custom domain. If you set a password it is visible in this conversation: only do it when the user asked for one and gave it.',
			inputSchema: z.object({
				organization_id: organizationId,
				url: destination,
				alias: z
					.string()
					.regex(/^[A-Za-z0-9_-]{3,15}$/, '3 to 15 letters, digits, - or _')
					.optional()
					.describe('Custom short code instead of a random one: 3 to 15 letters, digits, - or _. It must not be exactly 7 characters long.'),
				expires_at: z.iso.datetime({ offset: true }).optional().describe('When the link stops working, as an ISO 8601 date-time with a time zone, in the future.'),
				max_clicks: z.number().int().min(1).optional().describe('The link stops working after this many clicks.'),
				password: z.string().min(4).max(64).optional().describe('Visitors must enter this password: 4 to 64 characters.'),
				domain_id: z.number().int().positive().optional().describe('Id of a verified custom domain of the organization, from list_domains.'),
			}),
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
		},
		({ organization_id, url, alias, expires_at, max_clicks, password, domain_id }) =>
			guard(async () => {
				const { data } = await api.post(`/orgs/${segment(organization_id)}/links`, link, {
					body: { url, alias, expires_at, max_clicks, password, domain_id },
				});
				const notes = [
					data.protected ? 'password protected' : null,
					data.expires_at ? `expires ${data.expires_at}` : null,
					data.max_clicks !== null ? `max ${data.max_clicks} clicks` : null,
				].filter(Boolean);
				return ok(`Created ${data.short_url} -> ${oneLine(data.origin_url)} (link id ${data.id}${notes.length ? `, ${notes.join(', ')}` : ''}).`, {
					link: {
						id: data.id,
						code: data.code,
						short_url: data.short_url,
						origin_url: data.origin_url,
						domain_id: data.domain_id,
						expires_at: data.expires_at,
						max_clicks: data.max_clicks,
						password_protected: data.protected,
						created_at: data.created_at,
					},
				});
			})
	);
}

export function registerDeleteLink(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'delete_link',
		{
			title: 'Delete a link',
			description:
				'Permanently deletes a short link and its statistics. The short URL stops working and cannot be restored. Confirm with the user before calling this, and use list_links to find the link id.',
			inputSchema: z.object({
				organization_id: organizationId,
				link_id: z.number().int().positive().describe('Link id, from list_links.'),
			}),
			annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, link_id }) =>
			guard(async () => {
				await api.delete(`/orgs/${segment(organization_id)}/links/${segment(link_id)}`);
				return ok(`Deleted link ${link_id}.`, { deleted: true, link_id });
			})
	);
}
