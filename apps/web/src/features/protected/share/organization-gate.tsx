import { Building2, Plus } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import type { Organization } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { ApplicationState } from '~/components/ui/overlays-feedback/application-state/application-state';
import { useTranslate } from '~/hooks/use-translate';
import { OrganizationDialog } from '../organization/organization-dialog';
import { useCurrentOrganization } from '../organization/use-current-organization';

/**
 * Every page that shows an organization's data renders inside this gate. While organizations load, or when the user
 * has none, it fills the page with a centered state (the latter with a button to create one). Otherwise it renders
 * `children` with the selected organization, keyed by its id so the page's own state (page number, filters, open
 * dialogs) starts over whenever another organization is selected.
 */
export function OrganizationGate({ children }: { children: (organization: Organization & { id: number }) => ReactNode }) {
	const t = useTranslate();
	const { organization, isPending } = useCurrentOrganization();
	const [creating, setCreating] = useState(false);

	if (isPending) return <ApplicationState.LoadingState className='h-full' title={t('protected.organization.loading')} />;

	if (organization?.id === undefined) {
		return (
			<>
				<ApplicationState.EmptyState
					actions={
						<Button onClick={() => setCreating(true)}>
							<Button.Icon icon={Plus} />
							<Button.Text>{t('protected.organization.new')}</Button.Text>
						</Button>
					}
					className='h-full'
					description={t('protected.organization.empty.description')}
					icon={Building2}
					title={t('protected.organization.empty.title')}
				/>
				<OrganizationDialog onOpenChange={setCreating} open={creating} />
			</>
		);
	}

	return <Fragment key={organization.id}>{children({ ...organization, id: organization.id })}</Fragment>;
}
