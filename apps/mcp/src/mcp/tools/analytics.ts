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
export const day = z.string().refine(isDay, 'must be a real date as YYYY-MM-DD');

/** Whether the runtime knows `name` as an IANA time zone. */
export function isTimeZone(name: string) {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: name });
		return name.toLowerCase() !== 'local';
	} catch {
		return false;
	}
}

/** The time zone the days, hours and weekdays of a statistics tool are counted in. */
export const timeZone = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.refine(isTimeZone, 'must be an IANA time zone name such as America/Lima')
	.describe(
		"IANA time zone the days, hours and weekdays are counted in, such as America/Lima or Europe/Madrid. UTC when omitted. Use the user's own zone so the days match what they see in the dashboard."
	);

/** The five items with the most clicks, as "name (clicks), …". Names come from visitors, so they go on one line and are cut short. */
export function topCounts(items: { name: string; clicks: number }[]): string {
	return [...items]
		.sort((a, b) => b.clicks - a.clicks)
		.slice(0, 5)
		.map(i => `${oneLine(i.name, 80) || '(unknown)'} (${i.clicks})`)
		.join(', ');
}

export function registerLinkStats(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'get_link_stats',
		{
			title: 'Link click statistics',
			description:
				'Click statistics of one link: total clicks (with the previous period of the same length to compare), clicks per day, per hour of the day and per weekday (counted in the tz time zone, UTC by default), and the top referrers, countries and devices. Can be narrowed to one country, device or referrer. Without dates it covers the last 30 days.',
			inputSchema: z
				.object({
					organization_id: organizationId,
					link_id: linkId,
					from: day.optional().describe('First day to include, YYYY-MM-DD, a day of tz (UTC when tz is omitted).'),
					to: day.optional().describe('Last day to include, YYYY-MM-DD, a day of tz.'),
					tz: timeZone.optional(),
					country: z.string().trim().min(1).max(7).optional().describe('Only clicks from this country: ISO 3166-1 alpha-2 code such as PE, or "unknown".'),
					device: z.string().trim().min(1).max(16).optional().describe('Only clicks from this device: mobile, tablet, desktop, bot or "unknown".'),
					referrer: z.string().trim().min(1).max(255).optional().describe('Only clicks with this referrer exactly as listed, or "direct" for none.'),
				})
				.refine(v => !v.from || !v.to || v.from <= v.to, { message: 'from must not be after to', path: ['from'] }),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, link_id, from, to, tz, country, device, referrer }) =>
			guard(async () => {
				const { data } = await api.get(`/orgs/${segment(organization_id)}/links/${segment(link_id)}/stats`, linkStats, {
					query: { from, to, tz, country, device, referrer },
				});
				const filters = Object.entries({ country, device, referrer }).flatMap(([k, v]) => (v ? [`${k}=${oneLine(v, 80)}`] : []));
				const period = `from ${data.from} to ${data.to}${tz ? ` (${tz})` : ''}`;
				const busiest = data.daily.reduce<{ date: string; clicks: number } | null>((best, d) => (d.clicks > (best?.clicks ?? 0) ? d : best), null);
				const lines = data.total
					? [
							`Link ${data.link_id}: ${data.total} clicks ${period}${data.previous_total ? ` (${data.previous_total} in the previous period)` : ''}.`,
							filters.length ? `Filtered by ${filters.join(', ')}.` : null,
							busiest ? `Busiest day: ${busiest.date} (${busiest.clicks}).` : null,
							data.referrers.length ? `Top referrers: ${topCounts(data.referrers)}.` : null,
							data.countries.length ? `Top countries: ${topCounts(data.countries)}.` : null,
							data.devices.length ? `Top devices: ${topCounts(data.devices)}.` : null,
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
