'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../utils/tailwind/cn';

const pillVariants = cva('inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium font-primary transition-colors duration-150 ease-in-out', {
	defaultVariants: {
		variant: 'default',
	},
	variants: {
		variant: {
			default: 'border-transparent bg-muted text-foreground',
			destructive: 'border-transparent bg-destructive/10 text-destructive',
			outline: 'border-border text-foreground',
			success: 'border-transparent bg-success/10 text-success',
			warning: 'border-transparent bg-warning/15 text-warning',
		},
	},
});

const dotVariants = cva('size-1.5 shrink-0 rounded-full', {
	defaultVariants: {
		variant: 'default',
	},
	variants: {
		variant: {
			default: 'bg-muted-foreground',
			destructive: 'bg-destructive',
			outline: 'bg-foreground',
			success: 'bg-success',
			warning: 'bg-warning',
		},
	},
});

export type PillVariantProps = VariantProps<typeof pillVariants>['variant'];

const PillVariantContext = React.createContext<PillVariantProps>('default');

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
	/**
	 * Visual/semantic tone.
	 * @default "default"
	 */
	variant?: PillVariantProps;
}

/** Root pill element. Renders a `<span>` — a label, not an interactive control. */
function PillRoot({ variant = 'default', className, ...props }: PillProps) {
	return (
		<PillVariantContext.Provider value={variant}>
			<span
				className={cn(
					pillVariants({
						variant,
					}),
					className
				)}
				{...props}
			/>
		</PillVariantContext.Provider>
	);
}

export interface PillDotProps {
	className?: string;
}

/** Status dot, colored to match the enclosing `Pill`'s `variant`. */
function PillDot({ className }: PillDotProps) {
	const variant = React.useContext(PillVariantContext);
	return (
		<span
			aria-hidden='true'
			className={cn(
				dotVariants({
					variant,
				}),
				className
			)}
		/>
	);
}

export interface PillTextProps extends React.HTMLAttributes<HTMLSpanElement> {}

/** Label text for a `Pill`. */
function PillText({ className, ...props }: PillTextProps) {
	return <span className={cn('truncate', className)} {...props} />;
}

/**
 * Compound status pill.
 * @example
 * ```tsx
 * <Pill variant="success">
 *   <Pill.Dot />
 *   <Pill.Text>Active</Pill.Text>
 * </Pill>
 * ```
 */
export const Pill = Object.assign(PillRoot, {
	Dot: PillDot,
	Text: PillText,
});
