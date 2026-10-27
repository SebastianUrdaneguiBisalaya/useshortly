'use client';

import type * as React from 'react';

import { cn } from '../../utils/tailwind/cn';

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
	/**
	 * Axis the rule is drawn along.
	 * @default "horizontal"
	 */
	orientation?: 'horizontal' | 'vertical';
	/**
	 * Purely visual (no semantic boundary for assistive tech) vs. an actual
	 * content boundary that should be announced.
	 * @default true
	 */
	decorative?: boolean;
	/**
	 * Content (e.g. a short label like "or") set in the middle of the rule —
	 * always centered on both axes, with the line running on either side.
	 * Without it the separator is a single plain rule.
	 */
	children?: React.ReactNode;
}

/**
 * A thin rule dividing content, optionally carrying `children` centered on
 * the rule. Not a compound component — a divider has no
 * composable parts, so a single element is the correct, non-over-engineered
 * shape here (see `Icon`/`Loader` for the same call).
 */
export function Separator({ orientation = 'horizontal', decorative = true, className, children, ...props }: SeparatorProps) {
	const horizontal = orientation === 'horizontal';

	if (children) {
		const line = cn('flex-1 bg-border', horizontal ? 'h-px' : 'w-px');

		return (
			<div
				aria-orientation={decorative ? undefined : orientation}
				className={cn('flex shrink-0 items-center justify-center gap-3 font-primary text-sm text-muted-foreground', horizontal ? 'w-full flex-row' : 'h-full flex-col', className)}
				role={decorative ? 'none' : 'separator'}
				{...props}
			>
				<span aria-hidden='true' className={line} />
				<span className='shrink-0'>{children}</span>
				<span aria-hidden='true' className={line} />
			</div>
		);
	}

	return (
		<div
			aria-orientation={decorative ? undefined : orientation}
			className={cn('shrink-0 bg-border', horizontal ? 'h-px w-full' : 'h-full w-px', className)}
			role={decorative ? 'none' : 'separator'}
			{...props}
		/>
	);
}
