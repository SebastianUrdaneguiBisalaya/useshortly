import { useState } from 'react';
import { OrganizationSwitcher } from '~/components/ui/navigation/organization-switcher/organization-switcher';
import { cn } from '~/components/ui/utils/tailwind/cn';
import { useTranslate } from '~/hooks/use-translate';
import { CreateOrganizationDialog } from './create-organization-dialog';
import { useCurrentOrganization } from './use-current-organization';

/** Switcher of the sidebar: the user's organizations from the API, the selected one remembered, and "New organization". */
export function OrganizationMenu({ collapsed }: { collapsed: boolean }) {
	const t = useTranslate();
	const { organization, organizations, select } = useCurrentOrganization();
	const [creating, setCreating] = useState(false);

	return (
		<>
			<OrganizationSwitcher onValueChange={value => void select(Number(value))} value={organization?.id === undefined ? undefined : String(organization.id)}>
				<OrganizationSwitcher.Trigger
					aria-label={t('protected.organization.switch')}
					className={cn(
						'w-full border border-border',
						collapsed && ['md:justify-center md:px-0', organization ? 'md:[&>:not(:first-child)]:hidden' : 'md:[&>:last-child]:ml-0 md:[&>:not(:last-child)]:hidden']
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
					<OrganizationSwitcher.Action onSelect={() => setCreating(true)}>{t('protected.organization.new')}</OrganizationSwitcher.Action>
				</OrganizationSwitcher.Content>
			</OrganizationSwitcher>
			<CreateOrganizationDialog onOpenChange={setCreating} open={creating} />
		</>
	);
}
