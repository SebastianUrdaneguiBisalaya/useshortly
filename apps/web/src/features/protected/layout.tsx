import { LayoutDashboard, Link2, Menu } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Icon } from '~/components/ui/foundations/icon/icon';
import { SidebarFloat } from '~/components/ui/navigation/sidebar-float/sidebar-float';
import { useTranslate } from '~/hooks/use-translate';
import { requireSession } from './require-session';

/** Runs before any `/` or `/links` page renders: unauthenticated visitors are redirected to sign-in. */
export async function clientLoader() {
	await requireSession();
	return null;
}

// The session lives in the browser, so the first render of a protected page waits for `clientLoader`.
export function HydrateFallback() {
	return null;
}

/** Wraps every protected page with the sidebar on the left. */
export default function ProtectedLayout() {
	const t = useTranslate();
	const { pathname } = useLocation();
	const [mobileOpen, setMobileOpen] = useState(false);

	return (
		<div className='relative h-full w-full'>
			<SidebarFloat
				lang={{
					closeMenu: t('protected.sidebar.closeMenu'),
					collapseSidebar: t('protected.sidebar.collapse'),
					expandSidebar: t('protected.sidebar.expand'),
					primary: t('protected.sidebar.primary'),
				}}
				mobileOpen={mobileOpen}
				onMobileOpenChange={setMobileOpen}
			>
				<SidebarFloat.Header>
					<SidebarFloat.Brand as={Link} label='useshortly' to='/'>
						<Icon icon={Link2} size='md' />
					</SidebarFloat.Brand>
					<SidebarFloat.CollapseTrigger />
					<SidebarFloat.MobileCloseTrigger />
				</SidebarFloat.Header>
				<SidebarFloat.Nav>
					<SidebarFloat.Item active={pathname === '/'} as={Link} icon={LayoutDashboard} label={t('protected.nav.dashboard')} to='/' />
					<SidebarFloat.Item active={pathname.startsWith('/links')} as={Link} icon={Link2} label={t('protected.nav.links')} to='/links' />
				</SidebarFloat.Nav>
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
