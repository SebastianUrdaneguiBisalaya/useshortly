import { useHotkeys } from '@usehotkeys/react';
import { LogOut, Settings } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useLogout } from '~/api/endpoints/auth/auth';
import { SidebarFloat } from '~/components/ui/navigation/sidebar-float/sidebar-float';
import { UserProfile } from '~/components/ui/navigation/user-profile/user-profile';
import { cn } from '~/components/ui/utils/tailwind/cn';
import { useTranslate } from '~/hooks/use-translate';
import { useSessionStore } from '~/stores/session-store';
import { HotkeyKeys } from './command-menu';
import { SettingsDialog } from './settings-dialog';
import { UserAvatar } from './user-avatar';

const SETTINGS_HOTKEY = 'mod+,';

/** Account row for the sidebar footer. Opens a menu with Settings (also with `mod+,`) and Log out. `collapsed` shows only the avatar on desktop (the mobile drawer always shows the name). */
export function UserMenu({ collapsed }: { collapsed: boolean }) {
	const t = useTranslate();
	const navigate = useNavigate();
	const logout = useLogout();
	const clearSession = useSessionStore(state => state.clearSession);
	const user = useSessionStore(state => state.session?.user);
	const [settingsOpen, setSettingsOpen] = useState(false);

	useHotkeys(SETTINGS_HOTKEY, () => setSettingsOpen(true), {
		group: t('protected.command.general'),
		label: t('protected.nav.settings'),
	});

	if (!user) return null;

	const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || '';
	const initials = (user.first_name || user.email || '?').slice(0, 2).toUpperCase();

	return (
		<li>
			<SidebarFloat.Hint label={name}>
				<UserProfile>
					<UserProfile.Trigger
						avatar={<UserAvatar imageUrl={user.image_url} initials={initials} label={name} />}
						className={cn(collapsed && 'md:h-9 md:justify-center md:p-0 md:[&>span]:hidden')}
						email={user.email}
						name={name}
					/>
					<UserProfile.Content className='space-y-0.5'>
						<UserProfile.Item icon={Settings} onSelect={() => setSettingsOpen(true)}>
							<span className='flex min-w-44 items-center justify-between gap-4'>
								{t('protected.nav.settings')}
								<HotkeyKeys combo={SETTINGS_HOTKEY} />
							</span>
						</UserProfile.Item>
						<UserProfile.Item
							disabled={logout.isPending}
							icon={LogOut}
							onSelect={() =>
								logout.mutate(undefined, {
									// The local session goes even if the request fails: the user asked to leave.
									onSettled: () => {
										clearSession();
										void navigate('/auth/sign-in', {
											replace: true,
										});
									},
								})
							}
						>
							{logout.isPending ? t('protected.settings.loggingOut') : t('protected.settings.logout')}
						</UserProfile.Item>
					</UserProfile.Content>
				</UserProfile>
			</SidebarFloat.Hint>
			<SettingsDialog onOpenChange={setSettingsOpen} open={settingsOpen} />
		</li>
	);
}
