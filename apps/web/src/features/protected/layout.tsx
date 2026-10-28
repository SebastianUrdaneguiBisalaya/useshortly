import { Code, KeyRound, LayoutDashboard, Link2, Megaphone, Menu, QrCode, Users } from 'lucide-react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8';
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Icon } from '~/components/ui/foundations/icon/icon';
import { SidebarFloat } from '~/components/ui/navigation/sidebar-float/sidebar-float';
import { useTranslate } from '~/hooks/use-translate';
import { OrganizationMenu } from './organization/organization-menu';
import { useOrganizationTo } from './organization/use-current-organization';
import { CommandMenu } from './share/command-menu';
import { requireSession } from './share/require-session';
import { UserMenu } from './share/user-menu';
import { Button } from '../../components/ui/actions-controls/button/button';
import { Layout } from '../../components/ui/layout/layout/layout';

/** Runs before any `/`, `/links`, ... page renders: unauthenticated visitors are redirected to sign-in. */
export async function clientLoader() {
	await requireSession();
	return null;
}

// The session lives in the browser, so the first render of a protected page waits for `clientLoader`.
export function HydrateFallback() {
	return null;
}

/** Wraps every protected page with the sidebar on the left. `nuqs` (the `?org=` selection) is available to the sidebar and the pages. */
export default function ProtectedLayout() {
	return (
		<NuqsAdapter>
			<ProtectedShell />
		</NuqsAdapter>
	);
}

function ProtectedShell() {
	const t = useTranslate();
	const toOrganization = useOrganizationTo();
	const { pathname } = useLocation();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [collapsed, setCollapsed] = useState(true);

	return (
		<div className='relative h-full w-full'>
			<SidebarFloat
				lang={{
					closeMenu: t('protected.sidebar.closeMenu'),
					collapseSidebar: t('protected.sidebar.collapse'),
					expandSidebar: t('protected.sidebar.expand'),
					primary: t('protected.sidebar.primary'),
				}}
				collapsed={collapsed}
				mobileOpen={mobileOpen}
				onCollapsedChange={setCollapsed}
				onMobileOpenChange={setMobileOpen}
			>
				<SidebarFloat.Header>
					<SidebarFloat.Brand as={Link} label='useshortly' to={toOrganization('/')}>
						<Icon icon={Link2} size='md' />
					</SidebarFloat.Brand>
					<SidebarFloat.CollapseTrigger />
					<SidebarFloat.MobileCloseTrigger />
				</SidebarFloat.Header>
				<OrganizationMenu collapsed={collapsed} />
				<SidebarFloat.Nav>
					<SidebarFloat.Item active={pathname === '/'} as={Link} icon={LayoutDashboard} label={t('protected.nav.dashboard')} to={toOrganization('/')} />
					<SidebarFloat.Item active={pathname.startsWith('/links')} as={Link} icon={Link2} label={t('protected.nav.links')} to={toOrganization('/links')} />
					<SidebarFloat.Item active={pathname.startsWith('/qr-code')} as={Link} icon={QrCode} label={t('protected.nav.qrCode')} to={toOrganization('/qr-code')} />
					<SidebarFloat.Item active={pathname.startsWith('/campaigns')} as={Link} icon={Megaphone} label={t('protected.nav.campaigns')} to={toOrganization('/campaigns')} />
					<SidebarFloat.Item active={pathname.startsWith('/users')} as={Link} icon={Users} label={t('protected.nav.users')} to={toOrganization('/users')} />
					<SidebarFloat.Item active={pathname.startsWith('/api-keys')} as={Link} icon={KeyRound} label={t('protected.nav.apiKeys')} to={toOrganization('/api-keys')} />
					<SidebarFloat.Item active={pathname.startsWith('/docs')} as={Link} icon={Code} label={t('protected.nav.docs')} to={toOrganization('/docs')} />
				</SidebarFloat.Nav>
				<SidebarFloat.Footer>
					<CommandMenu />
					<SidebarFloat.Divider />
					<UserMenu collapsed={collapsed} />
				</SidebarFloat.Footer>
			</SidebarFloat>
			<div className='flex h-full flex-col overflow-y-auto md:pl-24'>
				<Layout.HStack className='w-full p-2'>
					<Button
						className='rounded-md p-2 md:hidden'
						variant="secondary"
						onClick={() => setMobileOpen(true)}
						type='button'
						aria-label={t('protected.sidebar.openMenu')}
					>
						<Button.Icon
							icon={<Icon icon={Menu} size='md' />}
						/>
					</Button>
				</Layout.HStack>
				<main className='min-h-0 flex-1'>
					<Outlet />
				</main>
			</div>
		</div>
	);
}
