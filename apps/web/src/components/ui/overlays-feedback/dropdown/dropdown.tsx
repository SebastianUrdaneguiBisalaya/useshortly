'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Separator } from '../../foundations/separator/separator';
import { useClickOutside } from '../../hooks/useClickOutside';
import { cn } from '../../utils/tailwind/cn';
import { useEscapeKey } from '../modal/modal';

interface DropdownContextValue {
	open: boolean;
	setOpen: (open: boolean) => void;
	triggerRef: React.RefObject<HTMLSpanElement | null>;
	contentRef: React.RefObject<HTMLDivElement | null>;
}

const DropdownContext = React.createContext<DropdownContextValue | null>(null);

function useDropdownContext() {
	const context = React.useContext(DropdownContext);
	if (!context) {
		throw new Error('Dropdown compound components must be used within <Dropdown>.');
	}
	return context;
}

export interface DropdownProps {
	children: React.ReactNode;
	/** Open state, for controlled usage. */
	open?: boolean;
	/** Initial open state, for uncontrolled usage. @default false */
	defaultOpen?: boolean;
	/** Called whenever the open state changes, controlled or not. */
	onOpenChange?: (open: boolean) => void;
}

/**
 * Compound dropdown menu, following the WAI-ARIA Menu Button pattern.
 * @example
 * ```tsx
 * <Dropdown>
 *   <Dropdown.Trigger>
 *     <Button variant="secondary"><Button.Text>Actions</Button.Text></Button>
 *   </Dropdown.Trigger>
 *   <Dropdown.Content>
 *     <Dropdown.Item onSelect={rename}>Rename</Dropdown.Item>
 *     <Dropdown.Separator />
 *     <Dropdown.Item onSelect={remove} variant="destructive">Delete</Dropdown.Item>
 *   </Dropdown.Content>
 * </Dropdown>
 * ```
 */
function DropdownRoot({ children, open: controlledOpen, defaultOpen = false, onOpenChange }: DropdownProps) {
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

	return <DropdownContext.Provider value={value}>{children}</DropdownContext.Provider>;
}

export interface DropdownTriggerProps {
	/** A single element (a `Button`, native `<button>`, etc.) that opens the menu. */
	children: React.ReactElement;
	className?: string;
}

/**
 * Wraps `children` in an inert positioning anchor and toggles the menu on
 * click — the wrapper (not `children` itself) owns the ref, so any trigger
 * element works regardless of whether it forwards refs.
 */
function Trigger({ children, className }: DropdownTriggerProps) {
	const { open, setOpen, triggerRef } = useDropdownContext();

	return (
		<span className={cn('inline-flex', className)} onClick={() => setOpen(!open)} ref={triggerRef}>
			{React.cloneElement(children, {
				'aria-expanded': open,
				'aria-haspopup': 'menu',
			} as React.HTMLAttributes<HTMLElement>)}
		</span>
	);
}

const GAP = 4;

function focusMenuItemAt(menu: HTMLElement, index: number) {
	const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'));
	if (items.length === 0) return;
	items[((index % items.length) + items.length) % items.length].focus();
}

export interface DropdownContentProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Horizontal alignment relative to the trigger. @default "start" */
	align?: 'start' | 'end';
}

/** Portaled, positioned menu panel. Flips above the trigger when there isn't room below, and supports arrow-key/Home/End navigation between `Dropdown.Item`s. */
function Content({ align = 'start', className, children, ...props }: DropdownContentProps) {
	const { open, triggerRef, contentRef } = useDropdownContext();
	const [style, setStyle] = React.useState<React.CSSProperties>({
		opacity: 0,
		pointerEvents: 'none',
		position: 'fixed',
	});

	const computePosition = React.useCallback(() => {
		const trigger = triggerRef.current;
		const content = contentRef.current;
		if (!trigger || !content) return;

		const triggerRect = trigger.getBoundingClientRect();
		const contentRect = content.getBoundingClientRect();
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

	React.useEffect(() => {
		if (open) contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
	}, [open, contentRef]);

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const menu = event.currentTarget;
		const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'));
		const index = items.indexOf(document.activeElement as HTMLElement);

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			focusMenuItemAt(menu, index + 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			focusMenuItemAt(menu, index - 1);
		} else if (event.key === 'Home') {
			event.preventDefault();
			focusMenuItemAt(menu, 0);
		} else if (event.key === 'End') {
			event.preventDefault();
			focusMenuItemAt(menu, items.length - 1);
		}
	};

	if (!open) return null;

	return createPortal(
		<div
			className={cn('z-50 min-w-40 animate-fade-scale-in rounded-md border border-border bg-background p-1 shadow-md', className)}
			onKeyDown={handleKeyDown}
			ref={contentRef}
			role='menu'
			style={style}
			{...props}
		>
			{children}
		</div>,
		document.body
	);
}

export interface DropdownItemProps {
	children: React.ReactNode;
	/** Called when this item is chosen (click, or Enter/Space while focused). Closes the menu afterward. */
	onSelect: () => void;
	disabled?: boolean;
	/** Styles the item as a destructive action (e.g. "Delete"). */
	variant?: 'default' | 'destructive';
	className?: string;
}

/** One menu action. */
function Item({ children, onSelect, disabled = false, variant = 'default', className }: DropdownItemProps) {
	const { setOpen } = useDropdownContext();

	const activate = () => {
		if (disabled) return;
		onSelect();
		setOpen(false);
	};

	return (
		<div
			aria-disabled={disabled}
			className={cn(
				'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left font-primary text-sm outline-none transition-colors duration-100 ease-in-out',
				disabled
					? 'cursor-not-allowed opacity-40'
					: variant === 'destructive'
						? 'text-destructive hover:bg-destructive/10 focus:bg-destructive/10'
						: 'text-foreground hover:bg-muted focus:bg-muted',
				className
			)}
			onClick={activate}
			onKeyDown={event => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					activate();
				}
			}}
			role='menuitem'
			tabIndex={-1}
		>
			{children}
		</div>
	);
}

export interface DropdownLabelProps {
	children: React.ReactNode;
	className?: string;
}

/** Non-interactive section heading above a run of `Dropdown.Item`s. */
function Label({ children, className }: DropdownLabelProps) {
	return (
		<div className={cn('px-2 py-1.5 font-primary text-xs font-medium text-muted-foreground', className)} role='presentation'>
			{children}
		</div>
	);
}

export interface DropdownSeparatorProps {
	className?: string;
}

/** Divider between groups of `Dropdown.Item`s. */
function DropdownSeparator({ className }: DropdownSeparatorProps) {
	return <Separator className={cn('my-1', className)} decorative />;
}

export const Dropdown = Object.assign(DropdownRoot, {
	Content,
	Item,
	Label,
	Separator: DropdownSeparator,
	Trigger,
});
