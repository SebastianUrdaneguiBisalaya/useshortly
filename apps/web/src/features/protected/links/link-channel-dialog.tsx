import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { getGetCampaignQueryKey, getListCampaignsQueryKey, useListCampaignChannels } from '~/api/endpoints/campaigns/campaigns';
import { getGetLinkQueryKey, getListLinksQueryKey, useSetLinkChannel } from '~/api/endpoints/links/links';
import type { Link } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Combobox } from '~/components/ui/forms-inputs/combobox/combobox';
import { Alert } from '~/components/ui/overlays-feedback/alert/alert';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';
import { useAllCampaigns } from '../campaigns/use-all-campaigns';
import { MAX_DESTINATION_LENGTH, withUtm } from '../campaigns/utm';

/** A campaign has at most 100 channels, so one request lists them all. */
const CHANNEL_LIMIT = 100;

/**
 * Moves a link to another campaign channel, or takes it out of its campaign. The short code never changes, so the link's
 * QR codes keep working; only its destination is rewritten with the new channel's UTM parameters.
 */
export function LinkChannelDialog({ orgID, link, onOpenChange }: { orgID: number; link: Link | undefined; onOpenChange: (open: boolean) => void }) {
	return (
		<Modal.Root onOpenChange={onOpenChange} open={link !== undefined}>
			{/* Remounted for every link so the pickers start from the campaign and channel it is in. */}
			{link && <LinkChannelForm key={link.id} link={link} onOpenChange={onOpenChange} orgID={orgID} />}
		</Modal.Root>
	);
}

function LinkChannelForm({ orgID, link, onOpenChange }: { orgID: number; link: Link; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const titleId = useId();
	const queryClient = useQueryClient();
	const setChannel = useSetLinkChannel();
	const [campaignID, setCampaignID] = useState(link.campaign_id ?? undefined);
	const [channelID, setChannelID] = useState(link.channel_id ?? undefined);
	const campaigns = useAllCampaigns(orgID);
	const channels = useListCampaignChannels(orgID, campaignID ?? 0, { limit: CHANNEL_LIMIT }, { query: { enabled: campaignID !== undefined } });

	const campaignName = campaigns.campaigns.find(campaign => campaign.id === campaignID)?.name;
	const channelName = channels.data?.data?.find(channel => channel.id === channelID)?.name;
	const unchanged = channelID === (link.channel_id ?? undefined);
	const incomplete = campaignID !== undefined && channelID === undefined;
	const leaving = campaignID === undefined && link.channel_id != null;
	const destination = campaignName && channelName ? withUtm(link.origin_url ?? '', campaignName, channelName) : undefined;
	const tooLong = destination !== undefined && destination.length > MAX_DESTINATION_LENGTH;

	const save = () => {
		if (link.id === undefined) return;
		// A missing channel_id takes the link out of its campaign.
		setChannel.mutate(
			{ data: channelID === undefined ? {} : { channel_id: channelID }, linkID: link.id, orgID },
			{
				onSuccess: async () => {
					await Promise.all([
						queryClient.invalidateQueries({ queryKey: getListLinksQueryKey(orgID) }),
						queryClient.invalidateQueries({ queryKey: getGetLinkQueryKey(orgID, link.id as number) }),
						// The campaigns count their links.
						queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(orgID) }),
						...[link.campaign_id, campaignID].flatMap(id => (id === undefined ? [] : [queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(orgID, id) })])),
					]);
					toast.success(t('protected.toast.linkChannelUpdated'));
					onOpenChange(false);
				},
			}
		);
	};

	return (
		<Modal.Content aria-labelledby={titleId}>
			<Modal.Header>
				<Modal.Title id={titleId}>{t('protected.links.channelDialog.title')}</Modal.Title>
				<Modal.Description>{t('protected.links.channelDialog.description')}</Modal.Description>
			</Modal.Header>
			<Modal.Body>
				<div className='flex flex-col gap-4'>
					<Combobox
						lang={{ clearSelection: t('protected.links.create.campaign.clear') }}
						loading={campaigns.isLoading}
						onValueChange={value => {
							setCampaignID(value === null ? undefined : Number(value));
							// A channel belongs to one campaign, so changing the campaign drops it.
							setChannelID(undefined);
						}}
						value={campaignID === undefined ? null : String(campaignID)}
					>
						<Combobox.Label>{t('protected.links.create.campaign.label')}</Combobox.Label>
						<Combobox.Input placeholder={t('protected.links.create.campaign.placeholder')} />
						<Combobox.Content>
							{campaigns.campaigns.map(campaign => (
								<Combobox.Item key={campaign.id} value={String(campaign.id)}>
									{campaign.name}
								</Combobox.Item>
							))}
						</Combobox.Content>
					</Combobox>
					<Combobox
						disabled={campaignID === undefined}
						errorMessage={incomplete ? t('protected.links.create.channel.required') : undefined}
						lang={{ clearSelection: t('protected.links.create.channel.clear') }}
						loading={channels.isLoading}
						onValueChange={value => setChannelID(value === null ? undefined : Number(value))}
						value={channelID === undefined ? null : String(channelID)}
					>
						<Combobox.Label>{t('protected.links.create.channel.label')}</Combobox.Label>
						<Combobox.Input placeholder={t('protected.links.create.channel.placeholder')} />
						<Combobox.Content>
							{(channels.data?.data ?? []).map(channel => (
								<Combobox.Item key={channel.id} value={String(channel.id)}>
									{channel.name}
								</Combobox.Item>
							))}
						</Combobox.Content>
					</Combobox>
					{destination && !unchanged && (
						<div className='flex flex-col gap-2'>
							<p className='font-medium text-sm'>{t('protected.links.create.preview.label')}</p>
							<code className='break-all rounded-md bg-muted px-3 py-2 font-mono text-xs'>{destination}</code>
						</div>
					)}
					{tooLong && (
						<Alert variant='warning'>
							<Alert.Description>{t('protected.links.create.preview.tooLong', { max: MAX_DESTINATION_LENGTH })}</Alert.Description>
						</Alert>
					)}
					{leaving && (
						<Alert variant='warning'>
							<Alert.Description>{t('protected.links.channelDialog.leaving')}</Alert.Description>
						</Alert>
					)}
				</div>
			</Modal.Body>
			<Modal.Footer>
				<Modal.Close>
					<Button type='button' variant='secondary'>
						<Button.Text>{t('protected.confirm.cancel')}</Button.Text>
					</Button>
				</Modal.Close>
				<Button disabled={unchanged || incomplete || tooLong} loading={setChannel.isPending} onClick={save}>
					<Button.Text>{t('protected.links.channelDialog.submit')}</Button.Text>
				</Button>
			</Modal.Footer>
		</Modal.Content>
	);
}
