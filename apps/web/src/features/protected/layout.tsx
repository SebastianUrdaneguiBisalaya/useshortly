import { LayoutDashboard, Link2, Menu, Settings } from 'lucide-react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8';
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Icon } from '~/components/ui/foundations/icon/icon';
import { SidebarFloat } from '~/components/ui/navigation/sidebar-float/sidebar-float';
import { useTranslate } from '~/hooks/use-translate';
import { CommandMenu } from './command-menu';
import { OrganizationMenu } from './organization/organization-menu';
import { useOrganizationTo } from './organization/use-current-organization';
import { requireSession } from './require-session';
import { UserMenu } from './user-menu';

/** Runs before any `/`, `/links` or `/settings` page renders: unauthenticated visitors are redirected to sign-in. */
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
					<SidebarFloat.Item active={pathname.startsWith('/settings')} as={Link} icon={Settings} label={t('protected.nav.settings')} to={toOrganization('/settings')} />
				</SidebarFloat.Nav>
				<SidebarFloat.Footer>
					<CommandMenu />
					<SidebarFloat.Divider />
					<UserMenu collapsed={collapsed} />
				</SidebarFloat.Footer>
			</SidebarFloat>
			<main className='h-full overflow-y-auto p-4 md:pl-24'>
				<button
					aria-label={t('protected.sidebar.openMenu')}
					className='mb-4 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden'
					onClick={() => setMobileOpen(true)}
					type='button'
				>
					<Icon icon={Menu} size='md' />
				</button>
				<Outlet />
			</main>
		</div>
	);
}
