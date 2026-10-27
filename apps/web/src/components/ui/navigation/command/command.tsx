'use client';

import { Search as SearchIcon, X as XIcon } from 'lucide-react';
import {
	Children,
	cloneElement,
	createContext,
	isValidElement,
	type ReactElement,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../foundations/icon/icon';
import { Loader } from '../../foundations/loader/loader';
import { useDialogTransition, useFocusTrap } from '../../overlays-feedback/modal/modal';
import { cn } from '../../utils/tailwind/cn';

type CommandShortcutPredicate = (event: KeyboardEvent) => boolean;

const defaultShortcut: CommandShortcutPredicate = event => (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';

type CommandContextValue = {
	open: boolean;
	setOpen: (open: boolean) => void;
	activeIndex: number;
	setActiveIndex: (index: number) => void;
	setItemCount: (count: number) => void;
	moveActive: (direction: 1 | -1) => void;
	selectActive: () => void;
	registerActiveHandler: (handler: (() => void) | null) => void;
	closeOnSelect: boolean;
};

const CommandContext = createContext<CommandContextValue | null>(null);

function useCommandContext() {
	const context = useContext(CommandContext);
	if (!context) {
		throw new Error('Command compound components must be used within <Command.Root>');
	}
	return context;
}

export interface CommandRootProps {
	children: ReactNode;
	/** Open state, for controlled usage. */
	open?: boolean;
	/** Initial open state, for uncontrolled usage. @default false */
	defaultOpen?: boolean;
	/** Called whenever the open state changes, controlled or not. */
	onOpenChange?: (open: boolean) => void;
	/** Closes the panel automatically after an item is selected. Defaults to true, matching macOS Command. */
	closeOnSelect?: boolean;
	/**
	 * Predicate that opens/toggles the panel on a global keydown. Defaults to Cmd/Ctrl+K,
	 * since the real macOS Cmd+Space shortcut is intercepted by the OS before it ever reaches the browser.
	 * Pass `null` to disable the global shortcut entirely and drive it only via `Command.Trigger`.
	 */
	shortcut?: CommandShortcutPredicate | null;
}

/** Root of the compound command palette; owns open state, the highlighted-row index, and the global keyboard shortcut. */
function Root({ children, open: controlledOpen, defaultOpen = false, onOpenChange, closeOnSelect = true, shortcut = defaultShortcut }: CommandRootProps) {
	const [internalOpen, setInternalOpen] = useState(defaultOpen);
	const isControlled = controlledOpen !== undefined;
	const open = isControlled ? controlledOpen : internalOpen;

	const setOpen = useCallback(
		(value: boolean) => {
			if (!isControlled) setInternalOpen(value);
			onOpenChange?.(value);
		},
		[isControlled, onOpenChange]
	);

	const [activeIndex, setActiveIndex] = useState(0);
	const [itemCount, setItemCount] = useState(0);
	const activeHandlerRef = useRef<(() => void) | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: resets the highlighted row whenever the result count changes, not on every render
	useEffect(() => {
		setActiveIndex(0);
	}, [itemCount]);

	const moveActive = useCallback(
		(direction: 1 | -1) => {
			setActiveIndex(prev => {
				if (itemCount === 0) return 0;
				return (prev + direction + itemCount) % itemCount;
			});
		},
		[itemCount]
	);

	const registerActiveHandler = useCallback((handler: (() => void) | null) => {
		activeHandlerRef.current = handler;
	}, []);

	const selectActive = useCallback(() => {
		activeHandlerRef.current?.();
	}, []);

	useEffect(() => {
		if (!shortcut) return;
		function handleKeyDown(event: KeyboardEvent) {
			if (shortcut?.(event)) {
				event.preventDefault();
				setOpen(!open);
			}
		}
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [shortcut, open, setOpen]);

	const value = useMemo<CommandContextValue>(
		() => ({
			activeIndex,
			closeOnSelect,
			moveActive,
			open,
			registerActiveHandler,
			selectActive,
			setActiveIndex,
			setItemCount,
			setOpen,
		}),
		[open, setOpen, activeIndex, moveActive, selectActive, registerActiveHandler, closeOnSelect]
	);

	return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}

type TriggerChildProps = {
	onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
};

export interface CommandTriggerProps {
	/** A single element (e.g. a `Button`) that opens the palette on click. */
	children: ReactElement<TriggerChildProps>;
}

/** Clones `children` and wires an `onClick` that opens the palette, preserving any existing handler. */
function Trigger({ children }: CommandTriggerProps) {
	const { setOpen } = useCommandContext();
	return cloneElement(children, {
		onClick: (event: ReactMouseEvent<HTMLElement>) => {
			children.props.onClick?.(event);
			setOpen(true);
		},
	});
}

export interface CommandCloseProps {
	/** A single element (e.g. a `Button`) that closes the palette on click. */
	children: ReactElement<TriggerChildProps>;
}

/** Clones `children` and wires an `onClick` that closes the palette, preserving any existing handler. */
function Close({ children }: CommandCloseProps) {
	const { setOpen } = useCommandContext();
	return cloneElement(children, {
		onClick: (event: ReactMouseEvent<HTMLElement>) => {
			children.props.onClick?.(event);
			setOpen(false);
		},
	});
}

export interface CommandContentProps {
	children: ReactNode;
	className?: string;
	/** Additional classes for the dimming backdrop behind the panel. */
	overlayClassName?: string;
	/** Portal target. @default document.body */
	container?: Element | null;
}

/** Portaled, centered palette panel: dimmed/blurred overlay + animated content, with a focus trap and body scroll lock while open. Closes on overlay click or Escape. */
function Content({ children, className, overlayClassName, container }: CommandContentProps) {
	const { open, setOpen } = useCommandContext();
	const { mounted, visible, animate } = useDialogTransition(open, () => setOpen(false));
	const contentRef = useRef<HTMLDivElement>(null);
	useFocusTrap(visible, contentRef);

	useEffect(() => {
		if (!visible) return;
		const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
		const previousOverflow = document.body.style.overflow;
		const previousPaddingRight = document.body.style.paddingRight;
		document.body.style.overflow = 'hidden';
		if (scrollbarWidth > 0) {
			const currentPaddingRight = Number.parseFloat(window.getComputedStyle(document.body).paddingRight);
			document.body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
		}
		return () => {
			document.body.style.overflow = previousOverflow;
			document.body.style.paddingRight = previousPaddingRight;
		};
	}, [visible]);

	if (!mounted || !visible) return null;

	return createPortal(
		<div className='fixed inset-0 z-150 flex justify-center px-4'>
			{/* biome-ignore lint/a11y/useSemanticElements: overlay de fondo, requiere ser un div de posicionamiento absoluto, no un <button> */}
			<div
				aria-hidden='true'
				className={cn('absolute inset-0 bg-overlay backdrop-blur transition-opacity duration-150 ease-out', animate ? 'opacity-100' : 'opacity-0', overlayClassName)}
				onClick={() => setOpen(false)}
				role='button'
				tabIndex={-1}
			/>
			<div
				aria-modal='true'
				className={cn(
					'relative mt-[12vh] flex h-fit max-h-[65vh] w-full max-w-160 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl backdrop-blur-2xl',
					'transition-all duration-200 ease-out',
					animate ? 'translate-y-0 scale-100 opacity-100' : '-translate-y-2 scale-95 opacity-0',
					className
				)}
				ref={contentRef}
				role='dialog'
				tabIndex={-1}
			>
				{children}
			</div>
		</div>,
		container ?? document.body
	);
}

export interface CommandSearchProps {
	value: string;
	onValueChange: (value: string) => void;
	placeholder?: string;
	className?: string;
	/** Focuses the input as soon as the palette opens. @default true */
	autoFocus?: boolean;
	/** Shows a spinner in place of the clear button, e.g. while results are being fetched. */
	loading?: boolean;
}

/** Search field driving the palette: also owns arrow-key/Enter navigation over `Command.Item`s. */
function Search({ value, onValueChange, placeholder = 'Search...', className, autoFocus = true, loading = false }: CommandSearchProps) {
	const { moveActive, selectActive } = useCommandContext();
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);

	function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			moveActive(1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			moveActive(-1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			selectActive();
		}
	}

	return (
		<div className='flex items-center gap-3 border-b border-border px-5 py-4'>
			<Icon className='text-muted-foreground' icon={SearchIcon} size='lg' />
			<input
				autoComplete='off'
				autoCorrect='off'
				className={cn('flex-1 bg-transparent font-primary text-base font-light text-foreground outline-none placeholder:text-muted-foreground', className)}
				onChange={event => onValueChange(event.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={placeholder}
				ref={inputRef}
				spellCheck={false}
				type='text'
				value={value}
			/>
			{loading && <Loader size='sm' />}
			{!loading && value && (
				<button
					className='shrink-0 cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors duration-150 ease-in-out hover:bg-muted hover:text-foreground focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!'
					onClick={() => onValueChange('')}
					type='button'
				>
					<Icon icon={XIcon} size='sm' />
				</button>
			)}
		</div>
	);
}

export interface CommandItemProps {
	children: ReactNode;
	/** Called when this item is chosen (click, or Enter while highlighted). */
	onSelect: () => void;
	disabled?: boolean;
	className?: string;
	/** Leading icon element. */
	icon?: ReactNode;
}

type CommandItemInjectedProps = {
	active?: boolean;
	index?: number;
};

/** One selectable row. `active`/`index` are injected by the enclosing `Command.List`, not passed directly. */
function Item({ children, onSelect, disabled = false, className, icon, active = false, index }: CommandItemProps & CommandItemInjectedProps) {
	const { registerActiveHandler, setOpen, closeOnSelect, setActiveIndex } = useCommandContext();
	const ref = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!active || disabled) return;
		registerActiveHandler(() => {
			onSelect();
			if (closeOnSelect) setOpen(false);
		});
	}, [active, disabled, onSelect, registerActiveHandler, closeOnSelect, setOpen]);

	useEffect(() => {
		if (active)
			ref.current?.scrollIntoView({
				block: 'nearest',
			});
	}, [active]);

	return (
		<button
			aria-selected={active}
			className={cn(
				'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left font-primary text-sm text-foreground transition-colors duration-100 ease-in-out',
				'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
				disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
				active && !disabled && 'bg-muted',
				className
			)}
			disabled={disabled}
			onClick={() => {
				if (disabled) return;
				onSelect();
				if (closeOnSelect) setOpen(false);
			}}
			onMouseMove={() => {
				if (!disabled && typeof index === 'number') setActiveIndex(index);
			}}
			ref={ref}
			role='option'
			type='button'
		>
			{icon && <span className='flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground'>{icon}</span>}
			<span className='min-w-0 flex-1'>{children}</span>
		</button>
	);
}

export interface CommandListProps {
	children: ReactNode;
	className?: string;
}

/** Wraps `Command.Item`s, injecting each one's `active`/`index` state and reporting the total count for arrow-key wraparound. */
function List({ children, className }: CommandListProps) {
	const { activeIndex, setItemCount } = useCommandContext();

	const { nodes, count } = useMemo(() => {
		let index = 0;
		const nodes = Children.map(children, child => {
			if (isValidElement(child) && child.type === Item) {
				const currentIndex = index++;
				return cloneElement(child as ReactElement<CommandItemProps & CommandItemInjectedProps>, {
					active: currentIndex === activeIndex,
					index: currentIndex,
				});
			}
			return child;
		});
		return {
			count: index,
			nodes,
		};
	}, [children, activeIndex]);

	useEffect(() => {
		setItemCount(count);
	}, [count, setItemCount]);

	return (
		<div className={cn('flex flex-col gap-0.5 overflow-y-auto p-2', className)} role='listbox'>
			{nodes}
		</div>
	);
}

export interface CommandEmptyProps {
	children: ReactNode;
	className?: string;
}

/** Shown in place of `Command.List` when there are no matching results. */
function Empty({ children, className }: CommandEmptyProps) {
	return <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center font-primary text-sm text-muted-foreground', className)}>{children}</div>;
}

export interface CommandGroupProps {
	children: ReactNode;
	className?: string;
}

/** Section heading above a run of `Command.Item`s. */
function Group({ children, className }: CommandGroupProps) {
	return <div className={cn('px-3 pb-1 pt-3 font-primary text-[11px] font-semibold tracking-wider text-muted-foreground', className)}>{children}</div>;
}

/**
 * Compound command palette (Cmd/Ctrl+K launcher pattern).
 * @example
 * ```tsx
 * <Command onOpenChange={setOpen} open={open}>
 *   <Command.Content>
 *     <Command.Search onValueChange={setQuery} value={query} />
 *     <Command.List>
 *       <Command.Group>Suggestions</Command.Group>
 *       <Command.Item onSelect={() => navigate("/settings")}>Settings</Command.Item>
 *     </Command.List>
 *   </Command.Content>
 * </Command>
 * ```
 */
export const Command = Object.assign(Root, {
	Close,
	Content,
	Empty,
	Group,
	Item,
	List,
	Search,
	Trigger,
});
