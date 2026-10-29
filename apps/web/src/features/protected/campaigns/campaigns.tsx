import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { getListCampaignsQueryKey, useDeleteCampaign, useListCampaigns } from '~/api/endpoints/campaigns/campaigns';
import type { Campaign } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { DataTable, type DataTableFeatures } from '~/components/ui/data-display/data-table/data-table';
import { TableToolbar } from '~/components/ui/data-display/table-toolbar/table-toolbar';
import { Page } from '~/components/ui/layout/page/page';
import { useLanguage } from '~/hooks/use-language';
import { useTranslate } from '~/hooks/use-translate';
import { formatDateTime } from '~/lib/date-time';
import { useOrganizationTo } from '../organization/use-current-organization';
import { DeleteRowButton } from '../share/delete-row-button';
import { OrganizationGate } from '../share/organization-gate';
import { CampaignDialog } from './campaign-dialog';

const PAGE_SIZE = 25;

export default function CampaignsPage() {
	return <OrganizationGate>{organization => <CampaignsContent orgID={organization.id} />}</OrganizationGate>;
}

function CampaignsContent({ orgID }: { orgID: number }) {
	const t = useTranslate();
	const { locale } = useLanguage();
	const navigate = useNavigate();
	const toOrganization = useOrganizationTo();
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<Campaign>();
	const deleteCampaign = useDeleteCampaign();
	const campaigns = useListCampaigns(orgID, {
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE,
	});
	const total = campaigns.data?.meta?.total ?? 0;

	const columns = useMemo<ColumnDef<DataTableFeatures, Campaign>[]>(
		() => [
			{
				cell: ({ row }) => (
					<div className='min-w-0'>
						<p className='truncate font-medium'>{row.original.name}</p>
						{row.original.description && <p className='truncate text-xs text-muted-foreground'>{row.original.description}</p>}
					</div>
				),
				header: t('protected.campaigns.columns.name'),
				id: 'name',
				size: 320,
			},
			{
				cell: ({ row }) => row.original.channel_count ?? 0,
				header: t('protected.campaigns.columns.channels'),
				id: 'channels',
				size: 110,
			},
			{
				cell: ({ row }) => row.original.link_count ?? 0,
				header: t('protected.campaigns.columns.links'),
				id: 'links',
				size: 110,
			},
			{
				cell: ({ row }) => formatDateTime(row.original.created_at, locale),
				header: t('protected.campaigns.columns.createdAt'),
				id: 'createdAt',
				size: 180,
			},
			{
				cell: ({ row }) => {
					const campaign = row.original;
					if (campaign.id === undefined) return null;
					// The row opens the campaign, so its buttons must not also trigger that.
					return (
						<div className='flex justify-end gap-1' onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
							<Button aria-label={t('protected.campaigns.edit.label')} onClick={() => setEditing(campaign)} size='icon' variant='ghost'>
								<Button.Icon icon={Pencil} />
							</Button>
							<DeleteRowButton
								description={t('protected.campaigns.delete.description')}
								label={t('protected.campaigns.delete.label')}
								onConfirm={async () => {
									await deleteCampaign.mutateAsync({ campaignID: campaign.id as number, orgID });
									toast.success(t('protected.toast.campaignDeleted'));
									await queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(orgID) });
								}}
								title={t('protected.campaigns.delete.title', { name: campaign.name ?? '' })}
							/>
						</div>
					);
				},
				header: '',
				id: 'actions',
				size: 110,
			},
		],
		[t, locale, orgID, queryClient, deleteCampaign]
	);

	return (
		<Page.Root className='h-full py-3 sm:py-3' size='full'>
			<Page.Header>
				<div>
					<Page.Title>{t('protected.campaigns.title')}</Page.Title>
					<Page.Description>{t('protected.campaigns.description')}</Page.Description>
				</div>
				<Page.Actions>
					<Button onClick={() => setCreating(true)}>
						<Button.Icon icon={Plus} />
						<Button.Text>{t('protected.campaigns.create.action')}</Button.Text>
					</Button>
				</Page.Actions>
			</Page.Header>
			<Page.Body className='min-h-0 flex-1'>
				<DataTable
					columns={columns}
					data={campaigns.data?.data ?? []}
					emptyMessage={t('protected.campaigns.empty')}
					isLoading={campaigns.isLoading}
					onRowClick={campaign => void navigate(toOrganization(`/campaigns/${campaign.id}`))}
					pagination={{
						onPageChange: setPage,
						page,
						pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
						pageSize: PAGE_SIZE,
						total,
					}}
					toolbar={
						<TableToolbar>
							<span />
							<TableToolbar.RefreshButton isRefreshing={campaigns.isFetching} label={t('protected.table.refresh')} onRefresh={() => void campaigns.refetch()} />
						</TableToolbar>
					}
				/>
			</Page.Body>
			<CampaignDialog onOpenChange={setCreating} open={creating} orgID={orgID} />
			{/* Keyed so the form starts from the campaign being edited every time it opens. */}
			<CampaignDialog campaign={editing} key={editing?.id} onOpenChange={open => !open && setEditing(undefined)} open={editing !== undefined} orgID={orgID} />
		</Page.Root>
	);
}
