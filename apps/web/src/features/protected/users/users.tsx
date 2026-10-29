import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getListMembersQueryKey, useListMembers, useRemoveMember } from '~/api/endpoints/orgs/orgs';
import type { Member } from '~/api/model';
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
import { UserAvatar } from '../share/user-avatar';
import { InviteMemberDialog } from './invite-member-dialog';

const PAGE_SIZE = 25;
const ROLES = ['OWNER', 'ADMIN'] as const;

function fullName(member: Member) {
	return [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email || '';
}

export default function UsersPage() {
	return <OrganizationGate>{organization => <UsersContent orgID={organization.id} />}</OrganizationGate>;
}

function UsersContent({ orgID }: { orgID: number }) {
	const t = useTranslate();
	const { locale } = useLanguage();
	const queryClient = useQueryClient();
	const members = useListMembers(orgID);
	const removeMember = useRemoveMember();
	const [inviting, setInviting] = useState(false);
	const [search, setSearch] = useState('');
	const [roles, setRoles] = useState<string[]>([]);
	const [page, setPage] = useState(1);

	const rows = useMemo(() => {
		const query = search.trim().toLowerCase();
		return (members.data?.data ?? []).filter(
			member => (roles.length === 0 || roles.includes(member.role ?? '')) && (query === '' || `${fullName(member)} ${member.email ?? ''}`.toLowerCase().includes(query))
		);
	}, [members.data, roles, search]);
	const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
	const currentPage = Math.min(page, pageCount);
	const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

	const roleLabel = (role?: string) => (role === 'OWNER' || role === 'ADMIN' ? t(`protected.users.roles.${role}`) : (role ?? '—'));

	const columns = useMemo<ColumnDef<DataTableFeatures, Member>[]>(
		() => [
			{
				cell: ({ row }) => {
					const member = row.original;
					const name = fullName(member);
					return (
						<div className='flex items-center gap-3'>
							<UserAvatar imageUrl={member.image_url} initials={(member.first_name || member.email || '?').slice(0, 2).toUpperCase()} label={name} />
							<span className='font-medium'>{name}</span>
						</div>
					);
				},
				header: t('protected.users.columns.name'),
				id: 'name',
				size: 240,
			},
			{
				cell: ({ row }) => row.original.email,
				header: t('protected.users.columns.email'),
				id: 'email',
				size: 240,
			},
			{
				cell: ({ row }) => (
					<Badge variant={row.original.role === 'OWNER' ? 'success' : 'default'}>
						<Badge.Text>{roleLabel(row.original.role)}</Badge.Text>
					</Badge>
				),
				header: t('protected.users.columns.role'),
				id: 'role',
				size: 120,
			},
			{
				cell: ({ row }) => formatDateTime(row.original.created_at, locale),
				header: t('protected.users.columns.createdAt'),
				id: 'createdAt',
				size: 180,
			},
			{
				// The API has no way to edit a member, so the only action is removing them (the owner cannot be removed).
				cell: ({ row }) => {
					const member = row.original;
					if (member.role === 'OWNER' || member.user_id === undefined) return null;
					return (
						<div className='flex justify-end'>
							<DeleteRowButton
								description={t('protected.users.delete.description')}
								label={t('protected.users.delete.label')}
								onConfirm={async () => {
									await removeMember.mutateAsync({
										orgID,
										userID: member.user_id as number,
									});
									toast.success(t('protected.toast.memberRemoved'));
									await queryClient.invalidateQueries({
										queryKey: getListMembersQueryKey(orgID),
									});
								}}
								title={t('protected.users.delete.title', {
									name: fullName(member),
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
		// biome-ignore lint/correctness/useExhaustiveDependencies: roleLabel only reads `t`
		[t, locale, orgID, queryClient, removeMember]
	);

	return (
		<Page.Root className='h-full py-3 sm:py-3' size='full'>
			<Page.Header>
				<div>
					<Page.Title>{t('protected.users.title')}</Page.Title>
					<Page.Description>{t('protected.users.description')}</Page.Description>
				</div>
				<Page.Actions>
					<Button onClick={() => setInviting(true)}>
						<Button.Icon icon={UserPlus} />
						<Button.Text>{t('protected.users.invite.action')}</Button.Text>
					</Button>
				</Page.Actions>
			</Page.Header>
			<Page.Body className='min-h-0 flex-1'>
				<DataTable
					columns={columns}
					data={pageRows}
					emptyMessage={t('protected.users.empty')}
					isLoading={members.isLoading}
					pagination={{
						onPageChange: setPage,
						page: currentPage,
						pageCount,
						pageSize: PAGE_SIZE,
						total: rows.length,
					}}
					toolbar={
						<TableToolbar>
							<div className='flex flex-wrap items-center gap-2'>
								<TableToolbar.Search
									clearLabel={t('protected.table.clearSearch')}
									onValueChange={value => {
										setSearch(value);
										setPage(1);
									}}
									placeholder={t('protected.users.search')}
									value={search}
								/>
								<TableToolbar.Filter
									label={t('protected.users.columns.role')}
									onChange={value => {
										setRoles(value);
										setPage(1);
									}}
									options={ROLES.map(role => ({
										label: roleLabel(role),
										value: role,
									}))}
									value={roles}
								/>
							</div>
							<TableToolbar.RefreshButton isRefreshing={members.isFetching} label={t('protected.table.refresh')} onRefresh={() => void members.refetch()} />
						</TableToolbar>
					}
				/>
			</Page.Body>
			<InviteMemberDialog onOpenChange={setInviting} open={inviting} orgID={orgID} />
		</Page.Root>
	);
}
