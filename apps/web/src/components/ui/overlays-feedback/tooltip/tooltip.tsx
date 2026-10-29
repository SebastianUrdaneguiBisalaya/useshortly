'use client';

import type { LucideIcon } from 'lucide-react';
import { HelpCircle } from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../foundations/icon/icon';
import { cn } from '../../utils/tailwind/cn';
import { useEscapeKey } from '../modal/modal';

const GAP = 8;

export interface IconTooltipProps {
	readonly description: string;
	/**
	 * Accessible name of the trigger button.
	 * @default "Show description"
	 */
	readonly 'aria-label'?: string;
	readonly icon?: LucideIcon;
	readonly iconClassName?: string;
}

/**
 * Icon button that reveals a description tooltip on hover, keyboard focus,
 * or click. Positioned natively — flips above/below the trigger and shifts
 * horizontally to stay in the viewport — following the same hand-rolled
 * approach `Select`/`DatePicker` already use in this library, rather than
 * depending on `@floating-ui/react`.
 */
export function IconTooltip({ description, icon = HelpCircle, iconClassName, 'aria-label': ariaLabel = 'Show description' }: IconTooltipProps) {
	const tooltipId = React.useId();
	const [isOpen, setIsOpen] = React.useState(false);
	const triggerRef = React.useRef<HTMLButtonElement>(null);
	const tooltipRef = React.useRef<HTMLDivElement>(null);
	const [style, setStyle] = React.useState<React.CSSProperties>({
		opacity: 0,
		pointerEvents: 'none',
		position: 'fixed',
	});

	const computePosition = React.useCallback(() => {
		const trigger = triggerRef.current;
		const tooltip = tooltipRef.current;
		if (!trigger || !tooltip) return;

		const triggerRect = trigger.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();
		const viewportWidth = window.innerWidth;

		const spaceAbove = triggerRect.top - GAP;
		const preferTop = spaceAbove >= tooltipRect.height;

		const left = Math.min(Math.max(GAP, triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2), viewportWidth - GAP - tooltipRect.width);

		setStyle({
			left,
			position: 'fixed',
			top: preferTop ? triggerRect.top - GAP - tooltipRect.height : triggerRect.bottom + GAP,
		});
	}, []);

	useEscapeKey(isOpen, () => setIsOpen(false));

	React.useLayoutEffect(() => {
		if (!isOpen) return;
		computePosition();
		window.addEventListener('scroll', computePosition, true);
		window.addEventListener('resize', computePosition);
		return () => {
			window.removeEventListener('scroll', computePosition, true);
			window.removeEventListener('resize', computePosition);
		};
	}, [isOpen, computePosition]);

	return (
		<>
			<button
				aria-describedby={isOpen ? tooltipId : undefined}
				aria-label={ariaLabel}
				className={cn(
					'inline-flex cursor-pointer items-center rounded-sm text-muted-foreground transition-colors duration-150 ease-in-out hover:text-foreground',
					'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
					iconClassName
				)}
				onBlur={() => setIsOpen(false)}
				onClick={() => setIsOpen(true)}
				onFocus={() => setIsOpen(true)}
				onMouseEnter={() => setIsOpen(true)}
				onMouseLeave={() => setIsOpen(false)}
				ref={triggerRef}
				type='button'
			>
				<Icon icon={icon} size='md' />
			</button>

			{isOpen &&
				createPortal(
					<div
						className='z-[1000] max-w-xs animate-fade-scale-in rounded-lg border border-border bg-background px-3 py-2 font-primary text-xs leading-relaxed text-foreground shadow-lg'
						id={tooltipId}
						ref={tooltipRef}
						role='tooltip'
						style={style}
					>
						{description}
					</div>,
					document.body
				)}
		</>
	);
}
