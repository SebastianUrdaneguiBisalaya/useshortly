import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getListApiKeysQueryKey, useDeleteApiKey, useListApiKeys } from '~/api/endpoints/api-keys/api-keys';
import type { APIKey } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Badge } from '~/components/ui/data-display/badge/badge';
import { DataTable, type DataTableFeatures } from '~/components/ui/data-display/data-table/data-table';
import { TableToolbar } from '~/components/ui/data-display/table-toolbar/table-toolbar';
import { Page } from '~/components/ui/layout/page/page';
import { useLanguage } from '~/hooks/use-language';
import { useTranslate } from '~/hooks/use-translate';
import { formatDateTime } from '~/lib/date-time';
import { DeleteRowButton } from '../share/delete-row-button';
import { OrganizationGate } from '../share/organization-gate';
import { CreateApiKeyDialog } from './create-api-key-dialog';

const PAGE_SIZE = 25;

export default function ApiKeysPage() {
	return <OrganizationGate>{organization => <ApiKeysContent orgID={organization.id} />}</OrganizationGate>;
}

function ApiKeysContent({ orgID }: { orgID: number }) {
	const t = useTranslate();
	const { locale } = useLanguage();
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);
	const [creating, setCreating] = useState(false);
	const keys = useListApiKeys(orgID, {
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE,
	});
	const deleteApiKey = useDeleteApiKey();
	const total = keys.data?.meta?.total ?? 0;

	const columns = useMemo<ColumnDef<DataTableFeatures, APIKey>[]>(
		() => [
			{
				cell: ({ row }) => <span className='font-medium'>{row.original.name}</span>,
				header: t('protected.apiKeys.columns.name'),
				id: 'name',
				size: 220,
			},
			{
				cell: ({ row }) => <code className='font-mono text-xs'>{row.original.prefix}…</code>,
				header: t('protected.apiKeys.columns.key'),
				id: 'prefix',
				size: 160,
			},
			{
				cell: ({ row }) => (
					<Badge variant={row.original.scope === 'write' ? 'warning' : 'default'}>
						<Badge.Text>{row.original.scope === 'read' || row.original.scope === 'write' ? t(`protected.apiKeys.scopes.${row.original.scope}`) : (row.original.scope ?? '—')}</Badge.Text>
					</Badge>
				),
				header: t('protected.apiKeys.columns.scope'),
				id: 'scope',
				size: 110,
			},
			{
				cell: ({ row }) => formatDateTime(row.original.last_used_at, locale, t('protected.apiKeys.never')),
				header: t('protected.apiKeys.columns.lastUsed'),
				id: 'lastUsed',
				size: 180,
			},
			{
				cell: ({ row }) => formatDateTime(row.original.expires_at, locale, t('protected.apiKeys.never')),
				header: t('protected.apiKeys.columns.expires'),
				id: 'expires',
				size: 180,
			},
			{
				cell: ({ row }) => formatDateTime(row.original.created_at, locale),
				header: t('protected.apiKeys.columns.createdAt'),
				id: 'createdAt',
				size: 180,
			},
			{
				// Keys cannot be edited, only revoked.
				cell: ({ row }) => {
					const apiKey = row.original;
					if (apiKey.id === undefined) return null;
					return (
						<div className='flex justify-end'>
							<DeleteRowButton
								description={t('protected.apiKeys.delete.description')}
								label={t('protected.apiKeys.delete.label')}
								onConfirm={async () => {
									await deleteApiKey.mutateAsync({
										keyID: apiKey.id as number,
										orgID,
									});
									toast.success(t('protected.toast.apiKeyDeleted'));
									await queryClient.invalidateQueries({
										queryKey: getListApiKeysQueryKey(orgID),
									});
								}}
								title={t('protected.apiKeys.delete.title', {
									name: apiKey.name ?? '',
								})}
							/>
						</div>
					);
				},
				header: '',
				id: 'actions',
				size: 64,
			},
		],
		[t, locale, orgID, queryClient, deleteApiKey]
	);

	return (
		<Page.Root className='h-full py-3 sm:py-3' size='full'>
			<Page.Header>
				<div>
					<Page.Title>{t('protected.apiKeys.title')}</Page.Title>
					<Page.Description>{t('protected.apiKeys.description')}</Page.Description>
				</div>
				<Page.Actions>
					<Button onClick={() => setCreating(true)}>
						<Button.Icon icon={Plus} />
						<Button.Text>{t('protected.apiKeys.create.action')}</Button.Text>
					</Button>
				</Page.Actions>
			</Page.Header>
			<Page.Body className='min-h-0 flex-1'>
				<DataTable
					columns={columns}
					data={keys.data?.data ?? []}
					emptyMessage={t('protected.apiKeys.empty')}
					isLoading={keys.isLoading}
					pagination={{
						onPageChange: setPage,
						page,
						pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
						pageSize: PAGE_SIZE,
						total,
					}}
					toolbar={
						// The API lists keys only by page, so there is nothing to filter by on the server: refresh is the only control.
						<TableToolbar>
							<span />
							<TableToolbar.RefreshButton isRefreshing={keys.isFetching} label={t('protected.table.refresh')} onRefresh={() => void keys.refetch()} />
						</TableToolbar>
					}
				/>
			</Page.Body>
			<CreateApiKeyDialog onOpenChange={setCreating} open={creating} orgID={orgID} />
		</Page.Root>
	);
}
