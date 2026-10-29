import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { segment } from '../../api/client.js';
import { campaign, campaignChannel, link } from '../../api/schemas.js';
import { structuredCampaign, structuredChannel } from './campaigns.js';
import { guard, ok, type ToolContext } from './helpers.js';
import { describeLink, structuredLink } from './links.js';
import { oneLine } from './text.js';

const organizationId = z.number().int().positive().describe('Organization id, from list_organizations.');
const campaignId = z.number().int().positive().describe('Campaign id, from list_campaigns.');

const campaignName = z.string().trim().min(1).max(100).describe('1 to 100 characters, unique in the organization ignoring case.');
const description = z.string().trim().max(500).describe('Up to 500 characters.');
const channelName = z.string().trim().min(1).max(50).describe('1 to 50 characters, unique in the campaign ignoring case. It becomes the utm_source of the links put in the channel.');

export function registerCreateCampaign(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'create_campaign',
		{
			title: 'Create a campaign',
			description:
				'Creates a campaign in an organization. A campaign groups the links shared for one initiative; it starts with no channels, so next add the places it is shared with add_campaign_channel, then put links in them with create_link or set_link_channel.',
			inputSchema: z.object({ organization_id: organizationId, name: campaignName, description: description.optional() }),
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
		},
		({ organization_id, name, description }) =>
			guard(async () => {
				const { data } = await api.post(`/orgs/${segment(organization_id)}/campaigns`, campaign, { body: { name, description } });
				return ok(`Created campaign ${oneLine(data.name, 100)} (campaign id ${data.id}). It has no channels yet: add one with add_campaign_channel.`, { campaign: structuredCampaign(data) });
			})
	);
}

export function registerUpdateCampaign(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'update_campaign',
		{
			title: 'Update a campaign',
			description:
				'Changes the name and/or the description of a campaign; a field you leave out stays as it is, and an empty description clears it. Links already in the campaign keep the utm_campaign they were given, so a new name only reaches the links put in its channels afterwards.',
			inputSchema: z
				.object({ organization_id: organizationId, campaign_id: campaignId, name: campaignName.optional(), description: description.optional() })
				.refine(v => v.name !== undefined || v.description !== undefined, { message: 'give a name or a description to change', path: ['name'] }),
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, campaign_id, name, description }) =>
			guard(async () => {
				const { data } = await api.patch(`/orgs/${segment(organization_id)}/campaigns/${segment(campaign_id)}`, campaign, { body: { name, description } });
				return ok(`Updated campaign ${data.id}: ${oneLine(data.name, 100)}.`, { campaign: structuredCampaign(data) });
			})
	);
}

export function registerDeleteCampaign(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'delete_campaign',
		{
			title: 'Delete a campaign',
			description:
				'Permanently deletes a campaign and its channels. Its links are not deleted: they keep working, outside any campaign, and keep the UTM parameters they already have. The statistics grouped by the campaign are lost. Confirm with the user before calling this, and use list_campaigns to find the campaign id.',
			inputSchema: z.object({ organization_id: organizationId, campaign_id: campaignId }),
			annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, campaign_id }) =>
			guard(async () => {
				await api.delete(`/orgs/${segment(organization_id)}/campaigns/${segment(campaign_id)}`);
				return ok(`Deleted campaign ${campaign_id}. Its links still work.`, { deleted: true, campaign_id });
			})
	);
}

export function registerAddCampaignChannel(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'add_campaign_channel',
		{
			title: 'Add a channel to a campaign',
			description:
				'Adds a channel to a campaign: a place the campaign is shared, such as Instagram or email. A link put in the channel gets utm_source (the channel name), utm_medium=useshortly and utm_campaign (the campaign name) added to its destination, so each channel has its own statistics. A campaign has at most 100 channels.',
			inputSchema: z.object({ organization_id: organizationId, campaign_id: campaignId, name: channelName }),
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
		},
		({ organization_id, campaign_id, name }) =>
			guard(async () => {
				const { data } = await api.post(`/orgs/${segment(organization_id)}/campaigns/${segment(campaign_id)}/channels`, campaignChannel, { body: { name } });
				return ok(`Added channel ${oneLine(data.name, 60)} (channel id ${data.id}) to campaign ${campaign_id}.`, { channel: structuredChannel(data) });
			})
	);
}

export function registerDeleteCampaignChannel(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'delete_campaign_channel',
		{
			title: 'Delete a channel of a campaign',
			description:
				'Permanently deletes a channel of a campaign. Its links are not deleted: they keep working, outside any campaign, and keep the UTM parameters they already have. Confirm with the user before calling this, and use list_campaign_channels to find the channel id.',
			inputSchema: z.object({
				organization_id: organizationId,
				campaign_id: campaignId,
				channel_id: z.number().int().positive().describe('Channel id, from list_campaign_channels.'),
			}),
			annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, campaign_id, channel_id }) =>
			guard(async () => {
				await api.delete(`/orgs/${segment(organization_id)}/campaigns/${segment(campaign_id)}/channels/${segment(channel_id)}`);
				return ok(`Deleted channel ${channel_id}. Its links still work.`, { deleted: true, campaign_id, channel_id });
			})
	);
}

export function registerSetLinkChannel(server: McpServer, { api }: ToolContext) {
	server.registerTool(
		'set_link_channel',
		{
			title: 'Put a link in a campaign channel',
			description:
				"Puts an existing link in a campaign channel, or moves it to another one: the destination is rewritten with the channel's utm_source, utm_medium=useshortly and utm_campaign, replacing those parameters if the link already had them. Without a channel_id it takes the link out of its campaign and removes those three parameters from the destination; a value the link had for them before it joined the campaign is not restored. The short code and the QR code do not change. The destination plus the parameters must fit in 255 characters.",
			inputSchema: z.object({
				organization_id: organizationId,
				link_id: z.number().int().positive().describe('Link id, from list_links.'),
				channel_id: z.number().int().positive().optional().describe('The channel to put the link in, from list_campaign_channels. Leave it out to take the link out of its campaign.'),
			}),
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		({ organization_id, link_id, channel_id }) =>
			guard(async () => {
				const { data } = await api.put(`/orgs/${segment(organization_id)}/links/${segment(link_id)}/channel`, link, { body: channel_id === undefined ? {} : { channel_id } });
				const where =
					data.channel_id === null
						? 'is no longer in a campaign'
						: `is now in campaign ${JSON.stringify(oneLine(data.campaign_name, 60))}, channel ${JSON.stringify(oneLine(data.channel_name, 40))}`;
				return ok(`Link ${data.id} ${where}.\n${describeLink(data)}`, { link: structuredLink(data) });
			})
	);
}
