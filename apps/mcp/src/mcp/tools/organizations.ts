import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { organization } from '../../api/schemas.js';
import { guard, ok, type ToolContext } from './helpers.js';
import { oneLine } from './text.js';

export function registerListOrganizations(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'list_organizations',
		{
			title: 'List organizations',
			description:
				'Lists the organizations the user belongs to, with their ids. Links, domains and statistics belong to an organization: call this first to find the organization id the other tools need.',
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		},
		() =>
			guard(async () => {
				const { data } = await api.get('/orgs', z.array(organization));
				const organizations = data.map(o => ({ id: o.id, name: o.name, description: o.description ?? null }));
				const text = organizations.length
					? organizations.map(o => `- id ${o.id}: ${oneLine(o.name, 100)}${o.description ? ` (${oneLine(o.description, 120)})` : ''}`).join('\n')
					: 'The user does not belong to any organization yet.';
				return ok(text, { organizations });
			})
	);
}
