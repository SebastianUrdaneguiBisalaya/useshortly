import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { segment } from '../../api/client.js';
import { campaign, campaignChannel, campaignStats, pageMeta } from '../../api/schemas.js';
import { day, topCounts } from './analytics.js';
import { guard, ok, type ToolContext } from './helpers.js';
import { oneLine } from './text.js';

type Campaign = z.output<typeof campaign>;
type Channel = z.output<typeof campaignChannel>;

const organizationId = z.number().int().positive().describe('Organization id, from list_organizations.');
const campaignId = z.number().int().positive().describe('Campaign id, from list_campaigns.');

export const structuredCampaign = (c: Campaign) => ({
	id: c.id,
	name: c.name,
	description: c.description,
	channel_count: c.channel_count,
	link_count: c.link_count,
	created_at: c.created_at,
	updated_at: c.updated_at,
});

export const structuredChannel = (c: Channel) => ({ id: c.id, campaign_id: c.campaign_id, name: c.name, created_at: c.created_at });

/** Names and descriptions are written by users, so they go on one line and are cut short in the prose; the structured result keeps them whole. */
export const describeCampaign = (c: Campaign) =>
	`- id ${c.id}: ${oneLine(c.name, 100)} — ${c.channel_count} ${c.channel_count === 1 ? 'channel' : 'channels'}, ${c.link_count} ${c.link_count === 1 ? 'link' : 'links'}${c.description ? ` (${oneLine(c.description, 120)})` : ''}`;

export const describeChannel = (c: Channel) => `- id ${c.id}: ${oneLine(c.name, 60)}`;

export function registerListCampaigns(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'list_campaigns',
		{
			title: 'List campaigns',
			description:
				'Lists the campaigns of an organization, newest first, with how many channels and links each has. A campaign groups the links shared for one initiative, split into channels such as Instagram or email. Use limit and offset to page through them: the result says whether more remain.',
			inputSchema: z.object({
				organization_id: organizationId,
				limit: z.number().int().min(1).max(100).default(20).describe('How many campaigns to return (1 to 100).'),
				offset: z.number().int().min(0).default(0).describe('How many campaigns to skip.'),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, limit, offset }) =>
			guard(async () => {
				const { data, meta } = await api.get(`/orgs/${segment(organization_id)}/campaigns`, z.array(campaign), { query: { limit, offset: offset || undefined } });
				const page = pageMeta.safeParse(meta);
				const total = page.success ? page.data.total : data.length;
				const nextOffset = offset + data.length < total ? offset + data.length : null;
				const summary = data.length
					? `Showing ${offset + 1}-${offset + data.length} of ${total} campaigns.${nextOffset !== null ? ` Use offset ${nextOffset} for the next page.` : ''}`
					: total === 0
						? 'This organization has no campaigns yet.'
						: `No campaigns at offset ${offset}: the organization has ${total}.`;
				return ok([summary, ...data.map(describeCampaign)].join('\n'), { campaigns: data.map(structuredCampaign), total, limit, offset, next_offset: nextOffset });
			})
	);
}

export function registerGetCampaign(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'get_campaign',
		{
			title: 'Get a campaign',
			description: 'Returns one campaign of an organization by its id: its name, description and how many channels and links it has. Use list_campaigns to find the campaign id.',
			inputSchema: z.object({ organization_id: organizationId, campaign_id: campaignId }),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, campaign_id }) =>
			guard(async () => {
				const { data } = await api.get(`/orgs/${segment(organization_id)}/campaigns/${segment(campaign_id)}`, campaign);
				return ok(describeCampaign(data), { campaign: structuredCampaign(data) });
			})
	);
}

export function registerListCampaignChannels(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'list_campaign_channels',
		{
			title: 'List the channels of a campaign',
			description:
				"Lists the channels of a campaign, oldest first. A channel is a place the campaign is shared; its name becomes the utm_source of the links put in it. Pass a channel's id to create_link or list_links, or use get_campaign_stats to compare how each channel performs. A campaign has at most 100 channels.",
			inputSchema: z.object({
				organization_id: organizationId,
				campaign_id: campaignId,
				limit: z.number().int().min(1).max(100).default(100).describe('How many channels to return (1 to 100).'),
				offset: z.number().int().min(0).default(0).describe('How many channels to skip.'),
			}),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, campaign_id, limit, offset }) =>
			guard(async () => {
				const { data, meta } = await api.get(`/orgs/${segment(organization_id)}/campaigns/${segment(campaign_id)}/channels`, z.array(campaignChannel), {
					query: { limit, offset: offset || undefined },
				});
				const page = pageMeta.safeParse(meta);
				const total = page.success ? page.data.total : data.length;
				const nextOffset = offset + data.length < total ? offset + data.length : null;
				const summary = data.length
					? `Campaign ${campaign_id} has ${total} ${total === 1 ? 'channel' : 'channels'}.${nextOffset !== null ? ` Use offset ${nextOffset} for the next page.` : ''}`
					: `Campaign ${campaign_id} has no channels yet.`;
				return ok([summary, ...data.map(describeChannel)].join('\n'), { channels: data.map(structuredChannel), total, limit, offset, next_offset: nextOffset });
			})
	);
}

export function registerCampaignStats(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'get_campaign_stats',
		{
			title: 'Campaign click statistics',
			description:
				'Click statistics of a whole campaign: total clicks across all its links (with the previous period of the same length to compare), the clicks of each channel (most clicks first, channels without clicks included), clicks per day, per UTC hour and per weekday, and the top referrers, countries and devices. Can be narrowed to one country, device or referrer. Without dates it covers the last 30 days; the longest period is 366 days.',
			inputSchema: z
				.object({
					organization_id: organizationId,
					campaign_id: campaignId,
					from: day.optional().describe('First day to include, YYYY-MM-DD (UTC).'),
					to: day.optional().describe('Last day to include, YYYY-MM-DD (UTC).'),
					country: z.string().trim().min(1).max(7).optional().describe('Only clicks from this country: ISO 3166-1 alpha-2 code such as PE, or "unknown".'),
					device: z.string().trim().min(1).max(16).optional().describe('Only clicks from this device: mobile, tablet, desktop, bot or "unknown".'),
					referrer: z.string().trim().min(1).max(255).optional().describe('Only clicks with this referrer exactly as listed, or "direct" for none.'),
				})
				.refine(v => !v.from || !v.to || v.from <= v.to, { message: 'from must not be after to', path: ['from'] }),
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, campaign_id, from, to, country, device, referrer }) =>
			guard(async () => {
				const { data } = await api.get(`/orgs/${segment(organization_id)}/campaigns/${segment(campaign_id)}/stats`, campaignStats, {
					query: { from, to, country, device, referrer },
				});
				const filters = Object.entries({ country, device, referrer }).flatMap(([k, v]) => (v ? [`${k}=${oneLine(v, 80)}`] : []));
				const period = `from ${data.from} to ${data.to}`;
				const busiest = data.daily.reduce<{ date: string; clicks: number } | null>((best, d) => (d.clicks > (best?.clicks ?? 0) ? d : best), null);
				const channels = data.channels.map(c => `${oneLine(c.name, 60)} (${c.clicks})`).join(', ');
				const lines = data.total
					? [
							`Campaign ${data.campaign_id}: ${data.total} clicks ${period}${data.previous_total ? ` (${data.previous_total} in the previous period)` : ''}.`,
							filters.length ? `Filtered by ${filters.join(', ')}.` : null,
							channels ? `Clicks by channel: ${channels}.` : null,
							busiest ? `Busiest day: ${busiest.date} (${busiest.clicks}).` : null,
							data.referrers.length ? `Top referrers: ${topCounts(data.referrers)}.` : null,
							data.countries.length ? `Top countries: ${topCounts(data.countries)}.` : null,
							data.devices.length ? `Top devices: ${topCounts(data.devices)}.` : null,
						]
					: [`Campaign ${data.campaign_id} has no clicks ${period}.${channels ? ` Channels: ${channels}.` : ''}`];
				return ok(lines.filter(Boolean).join('\n'), {
					campaign_id: data.campaign_id,
					from: data.from,
					to: data.to,
					total: data.total,
					previous_total: data.previous_total,
					channels: data.channels,
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
