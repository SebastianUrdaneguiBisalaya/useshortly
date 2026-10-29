import { useQueries } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useMemo } from 'react';
import { getListCampaignChannelsQueryOptions, useListCampaignChannels, useListCampaigns } from '~/api/endpoints/campaigns/campaigns';
import type { Link } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Select } from '~/components/ui/forms-inputs/select/select';
import { useTranslate } from '~/hooks/use-translate';

/** A campaign has at most 100 channels; this many campaigns are offered in the filter. */
const PICKER_LIMIT = 100;
const ALL = '__all__';

/** Names of the campaigns and channels the given links are in, for the column that shows them. */
export function useCampaignNames(orgID: number, links: Link[]) {
	const campaigns = useListCampaigns(orgID, { limit: PICKER_LIMIT });
	const campaignIDs = [...new Set(links.flatMap(link => (link.campaign_id === undefined ? [] : [link.campaign_id])))];
	const channelLists = useQueries({ queries: campaignIDs.map(id => getListCampaignChannelsQueryOptions(orgID, id, { limit: PICKER_LIMIT })) });

	// The maps change only when a query brings new data, so the table's columns are not rebuilt on every render.
	const campaignsStamp = campaigns.dataUpdatedAt;
	const channelsStamp = channelLists.map(list => list.dataUpdatedAt).join();
	// biome-ignore lint/correctness/useExhaustiveDependencies: the stamp stands for the data it was taken from.
	const campaignNames = useMemo(() => new Map((campaigns.data?.data ?? []).map(campaign => [campaign.id, campaign.name])), [campaignsStamp]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the stamp stands for the data it was taken from.
	const channelNames = useMemo(() => new Map(channelLists.flatMap(list => (list.data?.data ?? []).map(channel => [channel.id, channel.name] as const))), [channelsStamp]);
	return { campaignNames, channelNames };
}

/** The campaign and channel filters of the links list, and the button that clears them. The channel filter needs a campaign. */
export function CampaignFilters({
	orgID,
	campaignID,
	channelID,
	onChange,
}: {
	orgID: number;
	campaignID: number | null;
	channelID: number | null;
	onChange: (filters: { campaign: number | null; channel: number | null }) => void;
}) {
	const t = useTranslate();
	const campaigns = useListCampaigns(orgID, { limit: PICKER_LIMIT });
	const channels = useListCampaignChannels(orgID, campaignID ?? 0, { limit: PICKER_LIMIT }, { query: { enabled: campaignID !== null } });

	return (
		<div className='flex flex-wrap items-center gap-2'>
			<div className='w-44'>
				{/* Another campaign has other channels, so the channel filter starts over with it. */}
				<Select.Root<string> onChange={value => onChange({ campaign: value === ALL ? null : Number(value), channel: null })} value={campaignID === null ? ALL : String(campaignID)}>
					<Select.Trigger aria-label={t('protected.links.filters.campaign')}>
						<Select.Value />
					</Select.Trigger>
					<Select.Content>
						<Select.ItemList>
							<Select.Item label={t('protected.links.filters.allCampaigns')} value={ALL}>
								{t('protected.links.filters.allCampaigns')}
							</Select.Item>
							{(campaigns.data?.data ?? []).map(campaign => (
								<Select.Item key={campaign.id} label={campaign.name ?? ''} value={String(campaign.id)}>
									{campaign.name}
								</Select.Item>
							))}
						</Select.ItemList>
					</Select.Content>
				</Select.Root>
			</div>
			<div className='w-44'>
				<Select.Root<string> onChange={value => onChange({ campaign: campaignID, channel: value === ALL ? null : Number(value) })} value={channelID === null ? ALL : String(channelID)}>
					<Select.Trigger aria-label={t('protected.links.filters.channel')} disabled={campaignID === null}>
						<Select.Value />
					</Select.Trigger>
					<Select.Content>
						<Select.ItemList>
							<Select.Item label={t('protected.links.filters.allChannels')} value={ALL}>
								{t('protected.links.filters.allChannels')}
							</Select.Item>
							{(channels.data?.data ?? []).map(channel => (
								<Select.Item key={channel.id} label={channel.name ?? ''} value={String(channel.id)}>
									{channel.name}
								</Select.Item>
							))}
						</Select.ItemList>
					</Select.Content>
				</Select.Root>
			</div>
			{(campaignID !== null || channelID !== null) && (
				<Button onClick={() => onChange({ campaign: null, channel: null })} variant='ghost'>
					<Button.Icon icon={X} />
					<Button.Text>{t('protected.links.filters.clear')}</Button.Text>
				</Button>
			)}
		</div>
	);
}
