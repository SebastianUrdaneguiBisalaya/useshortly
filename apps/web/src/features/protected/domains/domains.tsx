import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { BadgeCheck, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getListDomainsQueryKey, useDeleteDomain, useListDomains, useVerifyDomain } from '~/api/endpoints/domains/domains';
import type { Domain } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Badge } from '~/components/ui/data-display/badge/badge';
import { DataTable, type DataTableFeatures } from '~/components/ui/data-display/data-table/data-table';
import { TableToolbar } from '~/components/ui/data-display/table-toolbar/table-toolbar';
import { Page } from '~/components/ui/layout/page/page';
import { Alert } from '~/components/ui/overlays-feedback/alert/alert';
import { useLanguage } from '~/hooks/use-language';
import { useTranslate } from '~/hooks/use-translate';
import { formatDateTime } from '~/lib/date-time';
import { DeleteRowButton } from '../share/delete-row-button';
import { OrganizationGate } from '../share/organization-gate';
import { CreateDomainDialog } from './create-domain-dialog';

const PAGE_SIZE = 25;

export default function DomainsPage() {
	return <OrganizationGate>{organization => <DomainsContent orgID={organization.id} />}</OrganizationGate>;
}

function DomainsContent({ orgID }: { orgID: number }) {
	const t = useTranslate();
	const { locale } = useLanguage();
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);
	const [creating, setCreating] = useState(false);
	// `viewing` is kept after closing so the modal keeps its content while it animates out.
	const [viewing, setViewing] = useState<Domain>();
	const [viewOpen, setViewOpen] = useState(false);
	const [verifyFailed, setVerifyFailed] = useState(false);
	const domains = useListDomains(orgID, {
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE,
	});
	const deleteDomain = useDeleteDomain();
	const verifyDomain = useVerifyDomain();
	const total = domains.data?.meta?.total ?? 0;
	const refresh = () => queryClient.invalidateQueries({ queryKey: getListDomainsQueryKey(orgID) });

	const columns = useMemo<ColumnDef<DataTableFeatures, Domain>[]>(
		() => [
			{
				cell: ({ row }) => <span className='font-medium'>{row.original.host}</span>,
				header: t('protected.domains.columns.host'),
				id: 'host',
				size: 260,
			},
			{
				cell: ({ row }) => (
					<Badge variant={row.original.verified ? 'success' : 'warning'}>
						<Badge.Text>{row.original.verified ? t('protected.domains.status.verified') : t('protected.domains.status.pending')}</Badge.Text>
					</Badge>
				),
				header: t('protected.domains.columns.status'),
				id: 'status',
				size: 130,
			},
			{
				cell: ({ row }) => {
					const record = row.original.verification;
					if (row.original.verified || !record) return formatDateTime(row.original.verified_at, locale, t('protected.domains.never'));
					return (
						<code className='block max-w-sm truncate font-mono text-xs' title={record.value}>
							{record.type} {record.name} {record.value}
						</code>
					);
				},
				header: t('protected.domains.columns.record'),
				id: 'record',
				size: 340,
			},
			{
				cell: ({ row }) => formatDateTime(row.original.created_at, locale),
				header: t('protected.domains.columns.createdAt'),
				id: 'createdAt',
				size: 180,
			},
			{
				cell: ({ row }) => {
					const domain = row.original;
					if (domain.id === undefined) return null;
					return (
						<div className='flex justify-end gap-1' onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
							{!domain.verified && (
								<Button
									aria-label={t('protected.domains.verify.label')}
									disabled={verifyDomain.isPending}
									onClick={() =>
										verifyDomain.mutate(
											{ domainID: domain.id as number, orgID },
											{
												onError: () => setVerifyFailed(true),
												onSuccess: async response => {
													setVerifyFailed(!response.data?.verified);
													await refresh();
												},
											}
										)
									}
									size='icon'
									variant='ghost'
								>
									<Button.Icon icon={BadgeCheck} />
								</Button>
							)}
							<DeleteRowButton
								description={t('protected.domains.delete.description')}
								label={t('protected.domains.delete.label')}
								onConfirm={async () => {
									await deleteDomain.mutateAsync({ domainID: domain.id as number, orgID });
									toast.success(t('protected.toast.domainDeleted'));
									await refresh();
								}}
								title={t('protected.domains.delete.title', { host: domain.host ?? '' })}
							/>
						</div>
					);
				},
				header: '',
				id: 'actions',
				size: 110,
			},
		],
		// biome-ignore lint/correctness/useExhaustiveDependencies: `refresh` only closes over `queryClient` and `orgID`.
		[t, locale, orgID, queryClient, deleteDomain, verifyDomain]
	);

	return (
		<Page.Root className='h-full py-3 sm:py-3' size='full'>
			<Page.Header>
				<div>
					<Page.Title>{t('protected.domains.title')}</Page.Title>
					<Page.Description>{t('protected.domains.description')}</Page.Description>
				</div>
				<Page.Actions>
					<Button onClick={() => setCreating(true)}>
						<Button.Icon icon={Plus} />
						<Button.Text>{t('protected.domains.create.action')}</Button.Text>
					</Button>
				</Page.Actions>
			</Page.Header>
			<Page.Body className='min-h-0 flex-1'>
				{verifyFailed && (
					<Alert variant='warning'>
						<Alert.Description>{t('protected.domains.verify.failed')}</Alert.Description>
					</Alert>
				)}
				<DataTable
					columns={columns}
					data={domains.data?.data ?? []}
					emptyMessage={t('protected.domains.empty')}
					isLoading={domains.isLoading}
					onRowClick={domain => {
						if (!domain.verification) return;
						setViewing(domain);
						setViewOpen(true);
					}}
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
							<TableToolbar.RefreshButton isRefreshing={domains.isFetching} label={t('protected.table.refresh')} onRefresh={() => void domains.refetch()} />
						</TableToolbar>
					}
				/>
			</Page.Body>
			<CreateDomainDialog
				domain={creating ? undefined : viewing}
				onOpenChange={open => {
					if (!open) {
						setCreating(false);
						setViewOpen(false);
					}
				}}
				open={creating || viewOpen}
				orgID={orgID}
			/>
		</Page.Root>
	);
}
