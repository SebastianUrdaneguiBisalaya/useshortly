import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { parseAsInteger, useQueryState } from 'nuqs';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getListLinksQueryKey, useDeleteLink, useGetLink, useListLinks } from '~/api/endpoints/links/links';
import type { Link } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Badge } from '~/components/ui/data-display/badge/badge';
import { DataTable, type DataTableFeatures } from '~/components/ui/data-display/data-table/data-table';
import { TableToolbar } from '~/components/ui/data-display/table-toolbar/table-toolbar';
import { Page } from '~/components/ui/layout/page/page';
import { ConfirmDialog } from '~/components/ui/overlays-feedback/confirm-dialog/confirm-dialog';
import { useLanguage } from '~/hooks/use-language';
import { useTranslate } from '~/hooks/use-translate';
import { formatDateTime } from '~/lib/date-time';
import { useDownloadQr } from '../share/download-qr';
import { OrganizationGate } from '../share/organization-gate';
import { QrImage, resolveQrStyle } from '../share/qr-image';
import { CreateLinkDialog } from './create-link-dialog';
import { LinkActions } from './link-actions';
import { LinkChannelDialog } from './link-channel-dialog';
import { LinkDrawer } from './link-drawer';

const PAGE_SIZE = 25;

export default function LinksPage() {
	return <OrganizationGate>{organization => <LinksContent orgID={organization.id} />}</OrganizationGate>;
}

function LinksContent({ orgID }: { orgID: number }) {
	const t = useTranslate();
	const downloadQr = useDownloadQr();
	const { locale } = useLanguage();
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);
	const [creating, setCreating] = useState(false);
	// The open link lives in the URL (`?link=12`) so the drawer can be shared and the back button closes it.
	const [selectedID, setSelectedID] = useQueryState('link', parseAsInteger.withOptions({ history: 'push' }));
	const [deleting, setDeleting] = useState<Link>();
	const [changingChannel, setChangingChannel] = useState<Link>();
	const links = useListLinks(orgID, {
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE,
	});
	const deleteLink = useDeleteLink();
	const total = links.data?.meta?.total ?? 0;
	const rows = links.data?.data ?? [];
	// The drawer opens from the loaded page when the link is there; otherwise (a shared URL, another page) it is fetched by id.
	const inPage = rows.find(link => link.id === selectedID);
	const fetched = useGetLink(orgID, selectedID ?? 0, { query: { enabled: selectedID !== null && !inPage && !links.isLoading, retry: false } });
	const selected = inPage ?? fetched.data?.data;

	// A `?link=` that does not exist (deleted, another organization) would leave the URL pointing at nothing.
	useEffect(() => {
		if (fetched.isError) void setSelectedID(null, { history: 'replace' });
	}, [fetched.isError, setSelectedID]);

	const columns = useMemo<ColumnDef<DataTableFeatures, Link>[]>(
		() => [
			{
				cell: ({ row }) =>
					row.original.short_url ? (
						<div className='w-fit overflow-hidden rounded-md ring-1 ring-border' style={{ backgroundColor: resolveQrStyle(row.original.qr_style).background }}>
							<QrImage size={40} style={row.original.qr_style} value={row.original.short_url} />
						</div>
					) : null,
				header: '',
				id: 'qr',
				size: 72,
			},
			{
				// The destination sits under the short link it belongs to, so one cell answers "which link, and where does it go".
				cell: ({ row }) => (
					<div className='flex min-w-0 flex-col'>
						<span className='truncate font-medium text-foreground'>{row.original.short_url?.replace(/^https?:\/\//, '')}</span>
						<span className='truncate text-muted-foreground text-xs' title={row.original.origin_url}>
							{row.original.origin_url}
						</span>
					</div>
				),
				header: t('protected.links.columns.shortUrl'),
				id: 'shortUrl',
				size: 380,
			},
			{
				cell: ({ row }) => {
					const expired = row.original.expires_at ? new Date(row.original.expires_at).getTime() < Date.now() : false;
					return (
						<div className='flex gap-1.5'>
							{row.original.protected && (
								<Badge variant='warning'>
									<Badge.Text>{t('protected.links.badges.protected')}</Badge.Text>
								</Badge>
							)}
							{expired && (
								<Badge variant='destructive'>
									<Badge.Text>{t('protected.links.badges.expired')}</Badge.Text>
								</Badge>
							)}
						</div>
					);
				},
				header: t('protected.links.columns.access'),
				id: 'access',
				size: 160,
			},
			{
				cell: ({ row }) => row.original.max_clicks ?? t('protected.links.noLimit'),
				header: t('protected.links.columns.clicks'),
				id: 'clicks',
				size: 130,
			},
			{
				cell: ({ row }) => formatDateTime(row.original.expires_at, locale, t('protected.links.never')),
				header: t('protected.links.columns.expires'),
				id: 'expires',
				size: 180,
			},
			{
				cell: ({ row }) => formatDateTime(row.original.created_at, locale),
				header: t('protected.links.columns.createdAt'),
				id: 'createdAt',
				size: 180,
			},
			{
				cell: ({ row }) => (
					<LinkActions
						onChangeChannel={() => setChangingChannel(row.original)}
						onDelete={() => setDeleting(row.original)}
						onDownloadQr={() => row.original.short_url && void downloadQr(row.original.short_url, row.original.code ?? 'qr', row.original.qr_style)}
					/>
				),
				header: '',
				id: 'actions',
				size: 64,
			},
		],
		[t, locale]
	);

	return (
		<Page.Root className='h-full py-3 sm:py-3' size='full'>
			<Page.Header>
				<div>
					<Page.Title>{t('protected.links.title')}</Page.Title>
					<Page.Description>{t('protected.links.description')}</Page.Description>
				</div>
				<Page.Actions>
					<Button onClick={() => setCreating(true)}>
						<Button.Icon icon={Plus} />
						<Button.Text>{t('protected.links.create.action')}</Button.Text>
					</Button>
				</Page.Actions>
			</Page.Header>
			<Page.Body className='min-h-0 flex-1'>
				<DataTable
					columns={columns}
					data={rows}
					emptyMessage={t('protected.links.empty')}
					isLoading={links.isLoading}
					onRowClick={link => void setSelectedID(link.id ?? null)}
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
							<TableToolbar.RefreshButton isRefreshing={links.isFetching} label={t('protected.table.refresh')} onRefresh={() => void links.refetch()} />
						</TableToolbar>
					}
				/>
			</Page.Body>
			<CreateLinkDialog onOpenChange={setCreating} open={creating} orgID={orgID} />
			<LinkDrawer link={selected} onChangeChannel={setChangingChannel} onClose={() => void setSelectedID(null)} onDelete={setDeleting} orgID={orgID} />
			<LinkChannelDialog link={changingChannel} onOpenChange={open => !open && setChangingChannel(undefined)} orgID={orgID} />
			<ConfirmDialog.Root
				lang={{ cancel: t('protected.confirm.cancel'), confirm: t('protected.confirm.delete') }}
				onConfirm={async () => {
					if (deleting?.id === undefined) return;
					await deleteLink.mutateAsync({ linkID: deleting.id, orgID });
					toast.success(t('protected.toast.linkDeleted'));
					void setSelectedID(null, { history: 'replace' });
					await queryClient.invalidateQueries({ queryKey: getListLinksQueryKey(orgID) });
				}}
				onOpenChange={open => !open && setDeleting(undefined)}
				open={deleting !== undefined}
				variant='destructive'
			>
				<ConfirmDialog.Content>
					<ConfirmDialog.Icon />
					<ConfirmDialog.Title>{t('protected.links.delete.title', { code: deleting?.code ?? '' })}</ConfirmDialog.Title>
					<ConfirmDialog.Description>{t('protected.links.delete.description')}</ConfirmDialog.Description>
					<ConfirmDialog.Footer>
						<ConfirmDialog.Cancel />
						<ConfirmDialog.Confirm />
					</ConfirmDialog.Footer>
				</ConfirmDialog.Content>
			</ConfirmDialog.Root>
		</Page.Root>
	);
}
