import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { segment } from '../../api/client.js';
import { ApiUnavailableError } from '../../api/errors.js';
import { linkStats } from '../../api/schemas.js';
import { guard, ok, type ToolContext, type ToolResult } from './helpers.js';
import { oneLine } from './text.js';

const organizationId = z.number().int().positive().describe('Organization id, from list_organizations.');
const linkId = z.number().int().positive().describe('Link id, from list_links.');

const isDay = (value: string) => {
	const date = new Date(`${value}T00:00:00Z`);
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
};
const day = z.string().refine(isDay, 'must be a real date as YYYY-MM-DD');

export function registerLinkStats(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'get_link_stats',
		{
			title: 'Link click statistics',
			description:
				'Click statistics of one link: total clicks (with the previous period of the same length to compare), clicks per day, per UTC hour and per weekday, and the top referrers, countries and devices. Can be narrowed to one country, device or referrer. Without dates it covers the last 30 days.',
			inputSchema: z
				.object({
					organization_id: organizationId,
					link_id: linkId,
					from: day.optional().describe('First day to include, YYYY-MM-DD (UTC).'),
					to: day.optional().describe('Last day to include, YYYY-MM-DD (UTC).'),
					country: z.string().trim().min(1).max(7).optional().describe('Only clicks from this country: ISO 3166-1 alpha-2 code such as PE, or "unknown".'),
					device: z.string().trim().min(1).max(16).optional().describe('Only clicks from this device: mobile, tablet, desktop, bot or "unknown".'),
					referrer: z.string().trim().min(1).max(255).optional().describe('Only clicks with this referrer exactly as listed, or "direct" for none.'),
				})
				.refine(v => !v.from || !v.to || v.from <= v.to, { message: 'from must not be after to', path: ['from'] }),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, link_id, from, to, country, device, referrer }) =>
			guard(async () => {
				const { data } = await api.get(`/orgs/${segment(organization_id)}/links/${segment(link_id)}/stats`, linkStats, {
					query: { from, to, country, device, referrer },
				});
				const top = (items: { name: string; clicks: number }[]) =>
					[...items]
						.sort((a, b) => b.clicks - a.clicks)
						.slice(0, 5)
						.map(i => `${oneLine(i.name, 80) || '(unknown)'} (${i.clicks})`)
						.join(', ');

				const filters = Object.entries({ country, device, referrer }).flatMap(([k, v]) => (v ? [`${k}=${oneLine(v, 80)}`] : []));
				const period = `from ${data.from} to ${data.to}`;
				const busiest = data.daily.reduce<{ date: string; clicks: number } | null>((best, d) => (d.clicks > (best?.clicks ?? 0) ? d : best), null);
				const lines = data.total
					? [
							`Link ${data.link_id}: ${data.total} clicks ${period}${data.previous_total ? ` (${data.previous_total} in the previous period)` : ''}.`,
							filters.length ? `Filtered by ${filters.join(', ')}.` : null,
							busiest ? `Busiest day: ${busiest.date} (${busiest.clicks}).` : null,
							data.referrers.length ? `Top referrers: ${top(data.referrers)}.` : null,
							data.countries.length ? `Top countries: ${top(data.countries)}.` : null,
							data.devices.length ? `Top devices: ${top(data.devices)}.` : null,
						]
					: [`Link ${data.link_id} has no clicks ${period}.`];
				return ok(lines.filter(Boolean).join('\n'), {
					link_id: data.link_id,
					from: data.from,
					to: data.to,
					total: data.total,
					previous_total: data.previous_total,
					by_hour: data.by_hour,
					by_weekday: data.by_weekday,
					daily: data.daily,
					referrers: data.referrers,
					countries: data.countries,
					devices: data.devices,
				});
			})
	);
}

export function registerLinkQr(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'get_link_qr',
		{
			title: 'QR code of a link',
			description: 'Returns the QR code of a short link as a PNG image that points to its short URL.',
			inputSchema: z.object({
				organization_id: organizationId,
				link_id: linkId,
				size: z.number().int().min(64).max(1024).default(256).describe('Pixels on a side, 64 to 1024.'),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, link_id, size }) =>
			guard(async (): Promise<ToolResult> => {
				const { bytes, contentType } = await api.getBytes(`/orgs/${segment(organization_id)}/links/${segment(link_id)}/qr`, {
					query: { format: 'png', size },
				});
				// Only hand the client what was asked for: a PNG, never whatever bytes came back.
				if (!contentType.toLowerCase().startsWith('image/png')) {
					throw new ApiUnavailableError('the useshortly API did not return a PNG image');
				}
				return {
					content: [
						{ type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: 'image/png' },
						{ type: 'text', text: `QR code of link ${link_id} (PNG, ${size} px).` },
					],
					structuredContent: { link_id, format: 'png', size },
				};
			})
	);
}
