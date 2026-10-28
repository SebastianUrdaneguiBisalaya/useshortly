import { Link, useLocation } from 'react-router';
import { Avatar } from '~/components/ui/data-display/avatar/avatar';
import { UserProfile } from '~/components/ui/navigation/user-profile/user-profile';
import { cn } from '~/components/ui/utils/tailwind/cn';
import { useSessionStore } from '~/stores/session-store';

/** The signed-in user's Google picture (`image_url`) or, without one, the first two letters of their first name. */
function UserAvatar({ imageUrl, initials, label }: { imageUrl?: string; initials: string; label: string }) {
	// `Avatar.Fallback` only appears after an image fails to load, so a user without one gets the initials directly.
	if (!imageUrl) {
		return (
			<Avatar size='sm'>
				<div className='absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground'>{initials}</div>
			</Avatar>
		);
	}
	return (
		<Avatar size='sm'>
			<Avatar.Img alt={label} referrerPolicy='no-referrer' src={imageUrl} />
			<Avatar.Fallback>{initials}</Avatar.Fallback>
		</Avatar>
	);
}

/** Account row for the sidebar footer: links to `/profile`. `collapsed` shows only the avatar on desktop (the mobile drawer always shows the name). */
export function UserMenu({ collapsed }: { collapsed: boolean }) {
	const { pathname } = useLocation();
	const user = useSessionStore(state => state.session?.user);
	if (!user) return null;

	const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || '';
	const initials = (user.first_name || user.email || '?').slice(0, 2).toUpperCase();

	return (
		<li>
			<UserProfile.Link
				aria-current={pathname.startsWith('/profile') ? 'page' : undefined}
				as={Link}
				avatar={<UserAvatar imageUrl={user.image_url} initials={initials} label={name} />}
				className={cn(collapsed && 'md:[&>span]:hidden')}
				email={user.email}
				name={name}
				to='/profile'
			/>
		</li>
	);
}
