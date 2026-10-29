'use client';

import * as React from 'react';

import { cn } from '../../utils/tailwind/cn';

export type ProgressVariant = 'line' | 'circle';

interface ProgressContextValue {
	/** Current value, or `null` for indeterminate. */
	readonly value: number | null;
	readonly max: number;
	readonly variant: ProgressVariant;
	readonly size: number;
	readonly strokeWidth: number;
}

const ProgressContext = React.createContext<ProgressContextValue | null>(null);

function useProgressContext() {
	const context = React.useContext(ProgressContext);
	if (!context) {
		throw new Error('Progress subcomponents must be used within <Progress>.');
	}
	return context;
}

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Current value. Omit (or pass `undefined`) for an indeterminate progress bar. */
	value?: number;
	/**
	 * Value representing 100%.
	 * @default 100
	 */
	max?: number;
	/**
	 * Shape of the indicator: a horizontal `"line"` bar, or a `"circle"` ring with the `Progress.Label` centered inside it.
	 * @default "line"
	 */
	variant?: ProgressVariant;
	/**
	 * Diameter of the ring in pixels. Only applies to `variant="circle"`.
	 * @default 64
	 */
	size?: number;
	/**
	 * Thickness of the ring in pixels. Only applies to `variant="circle"`.
	 * @default 6
	 */
	strokeWidth?: number;
}

/**
 * Root of the compound progress indicator. Clamps `value` to `[0, max]` and
 * exposes it to `Progress.Indicator`/`Progress.Label` via context. The same
 * pieces render as a horizontal bar (`variant="line"`) or as a ring with the
 * percentage centered inside it (`variant="circle"`).
 * @example
 * ```tsx
 * <Progress value={progress}>
 *   <Progress.Indicator />
 *   <Progress.Label />
 * </Progress>
 *
 * <Progress value={progress} variant="circle">
 *   <Progress.Indicator />
 *   <Progress.Label />
 * </Progress>
 * ```
 */
function ProgressRoot({ value, max = 100, variant = 'line', size = 64, strokeWidth = 6, className, style, children, ...props }: ProgressProps) {
	const clamped = value === undefined ? null : Math.min(Math.max(value, 0), max);

	const contextValue = React.useMemo(
		() => ({
			max,
			size,
			strokeWidth,
			value: clamped,
			variant,
		}),
		[clamped, max, size, strokeWidth, variant]
	);

	return (
		<ProgressContext.Provider value={contextValue}>
			<div
				aria-valuemax={max}
				aria-valuemin={0}
				aria-valuenow={clamped ?? undefined}
				className={cn(variant === 'circle' ? 'relative inline-flex shrink-0 items-center justify-center' : 'relative flex w-full items-center gap-2', className)}
				role='progressbar'
				style={
					variant === 'circle'
						? {
								height: size,
								width: size,
								...style,
							}
						: style
				}
				{...props}
			>
				{children}
			</div>
		</ProgressContext.Provider>
	);
}

export interface ProgressIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * The track and filled portion — a bar for `variant="line"`, a ring for
 * `variant="circle"`. Changes animate via a CSS `transition` (native
 * Tailwind, no animation library), so both increasing and decreasing `value`
 * ease smoothly instead of jumping. Falls back to an indeterminate sliding
 * stripe (line) or spinning arc (circle) when `Progress`'s `value` is omitted.
 */
function ProgressIndicator({ className, ...props }: ProgressIndicatorProps) {
	const { value, max, variant, size, strokeWidth } = useProgressContext();
	const percent = value === null ? null : (value / max) * 100;

	if (variant === 'circle') {
		const radius = (size - strokeWidth) / 2;
		const circumference = 2 * Math.PI * radius;
		// Indeterminate shows a fixed quarter arc that spins.
		const filled = percent === null ? 25 : percent;
		const center = size / 2;

		return (
			<svg aria-hidden='true' className={cn('-rotate-90', percent === null && 'animate-spin motion-reduce:animate-none', className)} height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
				<circle className='stroke-border' cx={center} cy={center} fill='none' r={radius} strokeWidth={strokeWidth} />
				<circle
					className='stroke-foreground transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none'
					cx={center}
					cy={center}
					fill='none'
					r={radius}
					strokeDasharray={circumference}
					strokeDashoffset={circumference * (1 - filled / 100)}
					strokeLinecap='round'
					strokeWidth={strokeWidth}
				/>
			</svg>
		);
	}

	return (
		<div className={cn('relative h-2 w-full flex-1 overflow-hidden rounded-full bg-muted', className)} {...props}>
			{percent === null ? (
				<div className='absolute inset-y-0 animate-progress-indeterminate rounded-full bg-foreground' />
			) : (
				<div
					className='h-full rounded-full bg-foreground transition-[width] duration-500 ease-out'
					style={{
						width: `${percent}%`,
					}}
				/>
			)}
		</div>
	);
}

export interface ProgressLabelProps extends React.HTMLAttributes<HTMLSpanElement> {}

/** Optional percentage readout. Sits next to `Progress.Indicator` in a line, and is centered inside the ring in a circle. Renders nothing while indeterminate. */
function ProgressLabel({ className, ...props }: ProgressLabelProps) {
	const { value, max, variant } = useProgressContext();
	if (value === null) return null;

	return (
		<span
			className={cn(
				'font-primary tabular-nums',
				variant === 'circle' ? 'absolute inset-0 flex items-center justify-center text-sm font-medium text-foreground' : 'shrink-0 text-xs text-muted-foreground',
				className
			)}
			{...props}
		>
			{Math.round((value / max) * 100)}%
		</span>
	);
}

export const Progress = Object.assign(ProgressRoot, {
	Indicator: ProgressIndicator,
	Label: ProgressLabel,
});
