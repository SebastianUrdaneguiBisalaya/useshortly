'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import { useClickOutside } from '../../hooks/useClickOutside';
import { cn } from '../../utils/tailwind/cn';
import { useEscapeKey, useFocusTrap } from '../modal/modal';

interface PopoverContextValue {
	open: boolean;
	setOpen: (open: boolean) => void;
	triggerRef: React.RefObject<HTMLSpanElement | null>;
	contentRef: React.RefObject<HTMLDivElement | null>;
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

function usePopoverContext() {
	const context = React.useContext(PopoverContext);
	if (!context) {
		throw new Error('Popover compound components must be used within <Popover>.');
	}
	return context;
}

export interface PopoverProps {
	children: React.ReactNode;
	/** Open state, for controlled usage. */
	open?: boolean;
	/** Initial open state, for uncontrolled usage. @default false */
	defaultOpen?: boolean;
	/** Called whenever the open state changes, controlled or not. */
	onOpenChange?: (open: boolean) => void;
}

/**
 * Compound popover: an anchored panel of arbitrary content (unlike
 * `Dropdown`, which is specifically an action menu with `role="menu"` and
 * arrow-key navigation).
 * @example
 * ```tsx
 * <Popover>
 *   <Popover.Trigger>
 *     <Button variant="secondary"><Button.Text>Filters</Button.Text></Button>
 *   </Popover.Trigger>
 *   <Popover.Content>
 *     <p>Arbitrary content here.</p>
 *   </Popover.Content>
 * </Popover>
 * ```
 */
function PopoverRoot({ children, open: controlledOpen, defaultOpen = false, onOpenChange }: PopoverProps) {
	const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
	const isControlled = controlledOpen !== undefined;
	const open = isControlled ? controlledOpen : internalOpen;

	const setOpen = React.useCallback(
		(value: boolean) => {
			if (!isControlled) setInternalOpen(value);
			onOpenChange?.(value);
		},
		[isControlled, onOpenChange]
	);

	const triggerRef = React.useRef<HTMLSpanElement>(null);
	const contentRef = React.useRef<HTMLDivElement>(null);

	useClickOutside(triggerRef, () => setOpen(false), contentRef, open);
	useEscapeKey(open, () => setOpen(false));

	const value = React.useMemo(
		() => ({
			contentRef,
			open,
			setOpen,
			triggerRef,
		}),
		[open, setOpen]
	);

	return <PopoverContext.Provider value={value}>{children}</PopoverContext.Provider>;
}

export interface PopoverTriggerProps {
	/** A single element (a `Button`, native `<button>`, etc.) that opens the popover. */
	children: React.ReactElement;
}

/** Wraps `children` in an inert positioning anchor and toggles the popover on click — same technique as `Dropdown.Trigger`, so it works regardless of whether the trigger element forwards refs. */
function Trigger({ children }: PopoverTriggerProps) {
	const { open, setOpen, triggerRef } = usePopoverContext();

	return (
		<span className='inline-flex' onClick={() => setOpen(!open)} ref={triggerRef}>
			{React.cloneElement(children, {
				'aria-expanded': open,
				'aria-haspopup': 'dialog',
			} as React.HTMLAttributes<HTMLElement>)}
		</span>
	);
}

const GAP = 4;

export interface PopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Horizontal alignment relative to the trigger. @default "start" */
	align?: 'start' | 'end';
}

/** Portaled, positioned content panel. Flips above the trigger when there isn't room below, and traps focus while open. */
function Content({ align = 'start', className, children, ...props }: PopoverContentProps) {
	const { open, triggerRef, contentRef } = usePopoverContext();
	const [style, setStyle] = React.useState<React.CSSProperties>({
		opacity: 0,
		pointerEvents: 'none',
		position: 'fixed',
	});

	useFocusTrap(open, contentRef);

	const computePosition = React.useCallback(() => {
		const trigger = triggerRef.current;
		const content = contentRef.current;
		if (!trigger || !content) return;

		const triggerRect = trigger.getBoundingClientRect();
		// Layout size, not `getBoundingClientRect()`: the open animation scales
		// the panel (`animate-fade-scale-in`), and a rect measured mid-scale is
		// too small — the panel would land in the wrong place and jump the first
		// time the position is recomputed (e.g. on scroll).
		const contentRect = {
			height: content.offsetHeight,
			width: content.offsetWidth,
		};
		const viewportHeight = window.innerHeight;
		const viewportWidth = window.innerWidth;

		const spaceBelow = viewportHeight - triggerRect.bottom - GAP;
		const preferBelow = spaceBelow >= contentRect.height || spaceBelow >= triggerRect.top;

		const left = align === 'end' ? Math.max(GAP, triggerRect.right - contentRect.width) : Math.min(triggerRect.left, viewportWidth - GAP - contentRect.width);

		setStyle(
			preferBelow
				? {
						left,
						position: 'fixed',
						top: triggerRect.bottom + GAP,
					}
				: {
						bottom: viewportHeight - triggerRect.top + GAP,
						left,
						position: 'fixed',
					}
		);
	}, [align, triggerRef, contentRef]);

	React.useLayoutEffect(() => {
		if (!open) return;
		computePosition();
		window.addEventListener('scroll', computePosition, true);
		window.addEventListener('resize', computePosition);
		return () => {
			window.removeEventListener('scroll', computePosition, true);
			window.removeEventListener('resize', computePosition);
		};
	}, [open, computePosition]);

	if (!open) return null;

	return createPortal(
		<div
			className={cn('z-50 min-w-48 animate-fade-scale-in rounded-md border border-border bg-background p-3 text-sm font-primary text-foreground shadow-md', className)}
			ref={contentRef}
			role='dialog'
			style={style}
			tabIndex={-1}
			{...props}
		>
			{children}
		</div>,
		document.body
	);
}

export const Popover = Object.assign(PopoverRoot, {
	Content,
	Trigger,
});
