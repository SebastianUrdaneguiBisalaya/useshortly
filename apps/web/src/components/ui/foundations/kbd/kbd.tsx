'use client';

import type * as React from 'react';

import { cn } from '../../utils/tailwind/cn';

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {}

/**
 * A single keyboard key (e.g. next to a menu item or tooltip showing its
 * shortcut). Renders `<kbd>`, the correct semantic element — not a styled
 * `<span>`. `font-secondary` (monospace) is the legitimate case for it here.
 * @example
 * ```tsx
 * <Kbd>⌘</Kbd>
 * ```
 */
function KbdRoot({ className, ...props }: KbdProps) {
	return (
		<kbd
			className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-secondary text-xs font-medium text-muted-foreground', className)}
			{...props}
		/>
	);
}

export interface KbdGroupProps extends React.HTMLAttributes<HTMLElement> {}

/**
 * Groups several `Kbd`s into one shortcut (e.g. "Ctrl" + "K").
 * @example
 * ```tsx
 * <Kbd.Group>
 *   <Kbd>Ctrl</Kbd>
 *   <Kbd>K</Kbd>
 * </Kbd.Group>
 * ```
 */
function KbdGroup({ className, ...props }: KbdGroupProps) {
	return <kbd className={cn('inline-flex items-center gap-1', className)} {...props} />;
}

export const Kbd = Object.assign(KbdRoot, {
	Group: KbdGroup,
});
