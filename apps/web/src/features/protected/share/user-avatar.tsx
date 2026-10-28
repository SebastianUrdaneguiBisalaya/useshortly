import { Avatar } from '~/components/ui/data-display/avatar/avatar';

/** A user's picture (`image_url`) or, without one, their initials. */
export function UserAvatar({ imageUrl, initials, label }: { imageUrl?: string; initials: string; label: string }) {
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
