'use client';

import type * as React from 'react';

import { cn } from '../../utils/tailwind/cn';

export interface SkeletonRootProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Text announced to assistive tech while the skeleton is shown; visually hidden. */
	label?: string;
}

/**
 * Groups one or more `Skeleton.Item` placeholders under a single
 * `role="status"` live region, so screen readers announce the loading state
 * once instead of once per placeholder bar (which are themselves
 * `aria-hidden`, since they carry no information on their own).
 * @example
 * ```tsx
 * <Skeleton className="flex flex-col gap-2">
 *   <Skeleton.Item className="h-4 w-48" />
 *   <Skeleton.Item className="h-4 w-32" />
 * </Skeleton>
 * ```
 */
function SkeletonRoot({ label = 'Cargando…', className, children, ...props }: SkeletonRootProps) {
	return (
		<div aria-busy='true' aria-live='polite' className={cn('flex flex-col gap-2', className)} role='status' {...props}>
			<span className='sr-only'>{label}</span>
			{children}
		</div>
	);
}

export interface SkeletonItemProps extends React.HTMLAttributes<HTMLDivElement> {}

/** One pulsing placeholder bar. Decorative — hidden from assistive tech; the loading state is announced by `Skeleton`'s live region. */
function SkeletonItem({ className, ...props }: SkeletonItemProps) {
	return <div aria-hidden='true' className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export const Skeleton = Object.assign(SkeletonRoot, {
	Item: SkeletonItem,
});
