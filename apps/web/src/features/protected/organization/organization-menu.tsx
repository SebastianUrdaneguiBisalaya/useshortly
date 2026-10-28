import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { getListMyOrganizationsQueryKey, useDeleteOrganization } from '~/api/endpoints/orgs/orgs';
import { Button } from '~/components/ui/actions-controls/button/button';
import { ButtonGroup } from '~/components/ui/actions-controls/button-group/button-group';
import { OrganizationSwitcher } from '~/components/ui/navigation/organization-switcher/organization-switcher';
import { ConfirmDialog } from '~/components/ui/overlays-feedback/confirm-dialog/confirm-dialog';
import { cn } from '~/components/ui/utils/tailwind/cn';
import { useTranslate } from '~/hooks/use-translate';
import { OrganizationDialog } from './organization-dialog';
import { useCurrentOrganization, useOrganizationParam } from './use-current-organization';

/** Switcher of the sidebar: the user's organizations from the API, the selected one remembered, and "New organization". */
export function OrganizationMenu({ collapsed }: { collapsed: boolean }) {
	const t = useTranslate();
	const { organization, organizations, select } = useCurrentOrganization();
	const queryClient = useQueryClient();
	const [, setOrganizationId] = useOrganizationParam();
	const deleteOrganization = useDeleteOrganization();
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState(false);
	const [deleting, setDeleting] = useState(false);
	// Editing and deleting act on the selected organization, so they need at least one.
	const hasOrganization = organization?.id !== undefined;

	return (
		<>
			<OrganizationSwitcher onValueChange={value => void select(Number(value))} value={organization?.id === undefined ? undefined : String(organization.id)}>
				<OrganizationSwitcher.Trigger
					aria-label={t('protected.organization.switch')}
					className={cn(
						'w-full border border-border',
						collapsed && ['md:justify-center md:px-0', organization ? 'md:[&>:not(:first-child)]:hidden' : 'md:*:last:ml-0 md:[&>:not(:last-child)]:hidden']
					)}
					wrapperClassName='w-full'
				>
					{organization && <OrganizationSwitcher.Logo name={organization.name} size='sm' src={organization.logo_url} />}
					<OrganizationSwitcher.Details>
						<OrganizationSwitcher.Name>{organization?.name ?? t('protected.organization.none')}</OrganizationSwitcher.Name>
						{organization?.description && <OrganizationSwitcher.Description>{organization.description}</OrganizationSwitcher.Description>}
					</OrganizationSwitcher.Details>
				</OrganizationSwitcher.Trigger>
				<OrganizationSwitcher.Content>
					{organizations.map(item => (
						<OrganizationSwitcher.Item key={item.id} selectedLabel={t('protected.organization.selected')} value={String(item.id)}>
							<OrganizationSwitcher.Logo name={item.name} size='sm' src={item.logo_url} />
							<OrganizationSwitcher.Details>
								<OrganizationSwitcher.Name>{item.name}</OrganizationSwitcher.Name>
								{item.description && <OrganizationSwitcher.Description>{item.description}</OrganizationSwitcher.Description>}
							</OrganizationSwitcher.Details>
						</OrganizationSwitcher.Item>
					))}
					<ButtonGroup aria-label={t('protected.organization.actions')} className='w-full p-1'>
						<Button className='flex-1' onClick={() => setCreating(true)} variant='secondary'>
							<Button.Icon icon={Plus} />
							<Button.Text>{t('protected.organization.add')}</Button.Text>
						</Button>
						<Button className='flex-1' disabled={!hasOrganization} onClick={() => setEditing(true)} variant='secondary'>
							<Button.Icon icon={Pencil} />
							<Button.Text>{t('protected.organization.editAction')}</Button.Text>
						</Button>
						<Button className='flex-1' disabled={!hasOrganization} onClick={() => setDeleting(true)} variant='secondary'>
							<Button.Icon icon={Trash2} />
							<Button.Text>{t('protected.organization.deleteAction')}</Button.Text>
						</Button>
					</ButtonGroup>
				</OrganizationSwitcher.Content>
			</OrganizationSwitcher>
			<OrganizationDialog onOpenChange={setCreating} open={creating} />
			{/* Keyed by id so the form starts from the selected organization every time it opens. */}
			<OrganizationDialog key={organization?.id} onOpenChange={setEditing} open={editing && hasOrganization} organization={organization} />
			<ConfirmDialog.Root
				lang={{
					cancel: t('protected.organization.delete.cancel'),
					confirm: t('protected.organization.delete.confirm'),
				}}
				onConfirm={async () => {
					if (organization?.id === undefined) return;
					await deleteOrganization.mutateAsync({
						orgID: organization.id,
					});
					toast.success(t('protected.toast.organizationDeleted'));
					await setOrganizationId(null);
					await queryClient.invalidateQueries({
						queryKey: getListMyOrganizationsQueryKey(),
					});
				}}
				onOpenChange={setDeleting}
				open={deleting}
				variant='destructive'
			>
				<ConfirmDialog.Content>
					<ConfirmDialog.Icon />
					<ConfirmDialog.Title>{t('protected.organization.delete.title', { name: organization?.name ?? '' })}</ConfirmDialog.Title>
					<ConfirmDialog.Description>{t('protected.organization.delete.description')}</ConfirmDialog.Description>
					<ConfirmDialog.Footer>
						<ConfirmDialog.Cancel />
						<ConfirmDialog.Confirm />
					</ConfirmDialog.Footer>
				</ConfirmDialog.Content>
			</ConfirmDialog.Root>
		</>
	);
}
