import { Page } from '~/components/ui/layout/page/page';
import { OrganizationGate } from '../share/organization-gate';

export default function LinksPage() {
	return <OrganizationGate>{() => <Page.Root className='h-full' size='full' />}</OrganizationGate>;
}
