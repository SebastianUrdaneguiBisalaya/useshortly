import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getGetCampaignQueryKey, getListCampaignChannelsQueryKey, getListCampaignsQueryKey, useDeleteCampaignChannel } from '~/api/endpoints/campaigns/campaigns';
import { getListLinksQueryKey } from '~/api/endpoints/links/links';
import type { CampaignChannel } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { DataTable, type DataTableFeatures } from '~/components/ui/data-display/data-table/data-table';
import { Page } from '~/components/ui/layout/page/page';
import { useLanguage } from '~/hooks/use-language';
import { useTranslate } from '~/hooks/use-translate';
import { formatDateTime } from '~/lib/date-time';
import { DeleteRowButton } from '../share/delete-row-button';
import { ChannelDialog } from './channel-dialog';

/** The channels of a campaign, with the actions to add and remove them. */
export function CampaignChannels({ orgID, campaignID, channels, isLoading }: { orgID: number; campaignID: number; channels: CampaignChannel[]; isLoading: boolean }) {
	const t = useTranslate();
	const { locale } = useLanguage();
	const queryClient = useQueryClient();
	const [adding, setAdding] = useState(false);
	const deleteChannel = useDeleteCampaignChannel();

	const columns = useMemo<ColumnDef<DataTableFeatures, CampaignChannel>[]>(
		() => [
			{
				cell: ({ row }) => <span className='font-medium'>{row.original.name}</span>,
				header: t('protected.campaigns.detail.channels.columns.name'),
				id: 'name',
				size: 320,
			},
			{
				cell: ({ row }) => formatDateTime(row.original.created_at, locale),
				header: t('protected.campaigns.detail.channels.columns.createdAt'),
				id: 'createdAt',
				size: 180,
			},
			{
				cell: ({ row }) => {
					const channel = row.original;
					if (channel.id === undefined) return null;
					return (
						<div className='flex justify-end'>
							<DeleteRowButton
								description={t('protected.campaigns.detail.channels.delete.description')}
								label={t('protected.campaigns.detail.channels.delete.label')}
								onConfirm={async () => {
									await deleteChannel.mutateAsync({ campaignID, channelID: channel.id as number, orgID });
									toast.success(t('protected.toast.channelDeleted'));
									await Promise.all([
										queryClient.invalidateQueries({ queryKey: getListCampaignChannelsQueryKey(orgID, campaignID) }),
										queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(orgID, campaignID) }),
										queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(orgID) }),
										// The channel's links leave the campaign.
										queryClient.invalidateQueries({ queryKey: getListLinksQueryKey(orgID) }),
									]);
								}}
								title={t('protected.campaigns.detail.channels.delete.title', { name: channel.name ?? '' })}
							/>
						</div>
					);
				},
				header: '',
				id: 'actions',
				size: 64,
			},
		],
		[t, locale, orgID, campaignID, queryClient, deleteChannel]
	);

	return (
		<Page.Section>
			<Page.SectionHeader>
				<div>
					<Page.Title level='section'>{t('protected.campaigns.detail.channels.title')}</Page.Title>
					<Page.Description>{t('protected.campaigns.detail.channels.description')}</Page.Description>
				</div>
				<Page.Actions>
					<Button onClick={() => setAdding(true)}>
						<Button.Icon icon={Plus} />
						<Button.Text>{t('protected.campaigns.detail.channels.add')}</Button.Text>
					</Button>
				</Page.Actions>
			</Page.SectionHeader>
			<DataTable columns={columns} data={channels} emptyMessage={t('protected.campaigns.detail.channels.empty')} isLoading={isLoading} />
			<ChannelDialog campaignID={campaignID} onOpenChange={setAdding} open={adding} orgID={orgID} />
		</Page.Section>
	);
}
