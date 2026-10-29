import { X } from 'lucide-react';
import { useListCampaignChannels } from '~/api/endpoints/campaigns/campaigns';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Select } from '~/components/ui/forms-inputs/select/select';
import { useTranslate } from '~/hooks/use-translate';
import { useAllCampaigns } from '../campaigns/use-all-campaigns';

/** A campaign has at most 100 channels, so one request lists them all. */
const CHANNEL_LIMIT = 100;
const ALL = '__all__';

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
	const campaigns = useAllCampaigns(orgID);
	const channels = useListCampaignChannels(orgID, campaignID ?? 0, { limit: CHANNEL_LIMIT }, { query: { enabled: campaignID !== null } });

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
							{campaigns.campaigns.map(campaign => (
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
