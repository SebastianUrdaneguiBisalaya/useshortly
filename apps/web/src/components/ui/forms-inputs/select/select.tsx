'use client';

import { Check, ChevronDown, Search as SearchIcon, X } from 'lucide-react';
import { Children, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../foundations/icon/icon';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useEscapeKey } from '../../overlays-feedback/modal/modal';
import { cn } from '../../utils/tailwind/cn';

/** Texts rendered by `Select`'s subcomponents that have no override prop of their own. Pass `lang` to `Select.Root` to override any of them. */
export interface SelectLang {
	/** Accessible label of the overlay button that closes an open menu. */
	closeMenu: string;
	/** Accessible label of a selected tag's remove button, in `multiple` mode. */
	removeTag: string;
}

/** English defaults for `SelectLang`. */
export const defaultSelectLang: SelectLang = {
	closeMenu: 'Close dropdown menu',
	removeTag: 'Remove',
};

type SingleSelectProps<T extends string> = {
	children: React.ReactNode;
	multiple?: false;
	value?: T | null;
	defaultValue?: T;
	onChange?: (value: T) => void;
	labelMap?: Record<string, string>;
	/**
	 * Texts rendered by subcomponents. Merges over English defaults.
	 * @default defaultSelectLang
	 */
	lang?: Partial<SelectLang>;
	className?: string;
};

type MultiSelectProps<T extends string> = {
	children: React.ReactNode;
	multiple: true;
	value?: T[];
	defaultValue?: T[];
	onChange?: (value: T[]) => void;
	labelMap?: Record<string, string>;
	/**
	 * Texts rendered by subcomponents. Merges over English defaults.
	 * @default defaultSelectLang
	 */
	lang?: Partial<SelectLang>;
	className?: string;
};

type SelectRootProps<T extends string> = SingleSelectProps<T> | MultiSelectProps<T>;

type SelectContextType = {
	triggerId: string;
	contentId: string;
	multiple: boolean;
	value: string | null;
	values: string[];
	labels: Map<string, string>;
	lang: SelectLang;
	select: (value: string, label: string) => void;
	remove: (value: string) => void;
	open: boolean;
	setOpen: React.Dispatch<React.SetStateAction<boolean>>;
	query: string;
	setQuery: React.Dispatch<React.SetStateAction<string>>;
	triggerRef: React.RefObject<HTMLButtonElement | null>;
	contentRef: React.RefObject<HTMLDivElement | null>;
};

const SelectContext = createContext<SelectContextType | null>(null);

export function useSelect() {
	const context = useContext(SelectContext);
	if (!context) throw new Error('Select components must be used inside Select.Root');
	return context;
}

/**
 * Compound select. Accepts an optional `Select.Label`, a `Select.Trigger`,
 * and a `Select.Content` housing `Select.Search`/`Select.ItemList`/`Select.Item`.
 * Set `multiple` for multi-select (renders `Select.Tags` for chosen values).
 */
/**
 * Walks the (unrendered) `children` tree passed to `Select.Root` looking for
 * `Select.Item`s, seeding `value -> label` into `labels`. `Select.Content`
 * only mounts while `open` (see `Content`), so an `Item`'s label would
 * otherwise be unknown — and the trigger would show the raw value instead of
 * the label — until the user actually opens the menu and picks it. `children`
 * is plain data available at `Root` regardless of what's mounted, so this
 * recovers the label up front without needing `labelMap`.
 */
function collectItemLabels(children: React.ReactNode, labels: Map<string, string>): void {
	Children.forEach(children, child => {
		if (!isValidElement(child)) return;
		if (child.type === Item) {
			const itemProps = child.props as ItemProps<string>;
			const label = itemProps.label ?? (typeof itemProps.children === 'string' ? itemProps.children : itemProps.value);
			labels.set(itemProps.value, label);
			return;
		}
		const nested = (
			child.props as {
				children?: React.ReactNode;
			}
		).children;
		if (nested !== undefined) collectItemLabels(nested, labels);
	});
}

/**
 * Compound select. Accepts an optional `Select.Label`, a `Select.Trigger`,
 * and a `Select.Content` housing `Select.Search`/`Select.ItemList`/`Select.Item`.
 * Set `multiple` for multi-select (renders `Select.Tags` for chosen values).
 */
function Root<T extends string>(props: SelectRootProps<T>) {
	const { children, className, lang } = props;
	const resolvedLang = {
		...defaultSelectLang,
		...lang,
	};

	const triggerId = useId();
	const contentId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState<boolean>(false);
	const [query, setQuery] = useState<string>('');

	useClickOutside(rootRef, () => setOpen(false), contentRef);
	useEscapeKey(open, () => setOpen(false));

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		if (!open) setQuery('');
	}, [open]);

	const multiple = props.multiple === true;
	const isControlled = !multiple && 'value' in props;
	const isMultiControlled = multiple && 'value' in props;

	const [internalValue, setInternalValue] = useState<string | null>(!multiple ? ((props as SingleSelectProps<T>).defaultValue ?? null) : null);
	const [values, setValues] = useState<string[]>(multiple ? (isMultiControlled ? ((props as MultiSelectProps<T>).value ?? []) : ((props as MultiSelectProps<T>).defaultValue ?? [])) : []);

	const multiControlledValue = (props as MultiSelectProps<T>).value;

	useEffect(() => {
		if (!isMultiControlled) return;
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setValues(multiControlledValue ?? []);
	}, [isMultiControlled, multiControlledValue]);

	const labelMapProp = multiple ? (props as MultiSelectProps<T>).labelMap : (props as SingleSelectProps<T>).labelMap;

	const [labels, setLabels] = useState<Map<string, string>>(() => {
		const map = new Map<string, string>();
		if (labelMapProp) {
			Object.entries(labelMapProp).forEach(([k, v]) => {
				map.set(k, v);
			});
		}
		collectItemLabels(children, map);
		return map;
	});

	useEffect(() => {
		if (!labelMapProp) return;
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setLabels(prev => {
			const next = new Map(prev);
			Object.entries(labelMapProp).forEach(([k, v]) => {
				next.set(k, v);
			});
			return next;
		});
	}, [labelMapProp]);

	// Re-collects `value -> label` from `children` whenever they change (e.g. on
	// language switch, when `Select.Item` labels re-render translated) — the
	// initial `useState(() => ...)` above only runs once at mount, so without
	// this the trigger's `Select.Value` keeps showing the stale label.
	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setLabels(prev => {
			const next = new Map(prev);
			collectItemLabels(children, next);
			return next;
		});
	}, [children]);

	const value = isControlled ? ((props as SingleSelectProps<T>).value ?? null) : internalValue;

	const select = (optionValue: string, label: string) => {
		setLabels(prev => {
			const next = new Map(prev);
			next.set(optionValue, label);
			return next;
		});

		if (multiple) {
			setValues(prev => {
				const next = prev.includes(optionValue) ? prev.filter(v => v !== optionValue) : [...prev, optionValue];
				return next;
			});
			const next = values.includes(optionValue) ? values.filter(v => v !== optionValue) : [...values, optionValue];
			(props as MultiSelectProps<T>).onChange?.(next as T[]);
			return;
		}

		if (!isControlled) setInternalValue(optionValue);
		(props as SingleSelectProps<T>).onChange?.(optionValue as T);
		setOpen(false);
	};

	const remove = (optionValue: string) => {
		if (!multiple) return;
		const next = values.filter(v => v !== optionValue);
		setValues(next);
		(props as MultiSelectProps<T>).onChange?.(next as T[]);
	};

	return (
		<SelectContext.Provider
			value={{
				contentId,
				contentRef,
				labels,
				lang: resolvedLang,
				multiple,
				open,
				query,
				remove,
				select,
				setOpen,
				setQuery,
				triggerId,
				triggerRef,
				value,
				values,
			}}
		>
			<div className={cn('relative flex h-full flex-col gap-1.5', className)} ref={rootRef}>
				{children}
			</div>
		</SelectContext.Provider>
	);
}

export interface SelectLabelProps {
	children: React.ReactNode;
	className?: string;
}

/** Optional label associated with `Select.Trigger` via `htmlFor`/`id`. */
function Label({ children, className }: SelectLabelProps) {
	const { triggerId } = useSelect();
	return (
		<label className={cn('text-sm font-medium font-primary text-foreground', className)} htmlFor={triggerId}>
			{children}
		</label>
	);
}

export interface SelectTriggerProps {
	children: React.ReactNode;
	className?: string;
	/** Accessible name of the trigger when it has no `Select.Label` (e.g. a compact trigger showing only a flag). */
	'aria-label'?: string;
	/**
	 * Prevents opening the menu.
	 * @default false
	 */
	disabled?: boolean;
}

function Trigger({ children, className, 'aria-label': ariaLabel, disabled = false }: SelectTriggerProps) {
	const { open, setOpen, triggerId, contentId, triggerRef } = useSelect();

	return (
		<button
			aria-controls={contentId}
			aria-expanded={open}
			aria-haspopup='listbox'
			aria-label={ariaLabel}
			className={cn(
				'flex h-9 w-full flex-row items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2',
				'text-sm font-primary text-foreground transition-colors duration-150 ease-in-out',
				'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
				'cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-50',
				className
			)}
			disabled={disabled}
			id={triggerId}
			onClick={() => setOpen(!open)}
			onKeyDown={event => {
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					event.preventDefault();
					setOpen(true);
				}
			}}
			ref={triggerRef}
			type='button'
		>
			{children}
			<Icon className={cn('shrink-0 text-muted-foreground transition-transform duration-150 ease-in-out', open && 'rotate-180')} icon={ChevronDown} size='sm' />
		</button>
	);
}

function Value({ placeholder }: { placeholder?: string }) {
	const { multiple, value, values, labels } = useSelect();

	if (multiple) {
		return (
			<span className={cn('truncate', values.length === 0 && 'text-muted-foreground')}>{values.length > 0 ? `${values.length} seleccionado${values.length > 1 ? 's' : ''}` : placeholder}</span>
		);
	}

	const label = value ? (labels.get(value) ?? value) : null;

	return <span className={cn('truncate', !label && 'text-muted-foreground')}>{label ?? placeholder}</span>;
}

/**
 * `useLayoutEffect` avisa en SSR; el contenido solo se monta en cliente, pero el hook igual
 * se evalúa durante el render del servidor.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const GAP = 4;
const MAX_CONTENT_HEIGHT = 256;
const MIN_SPACE_FOR_BOTTOM = 120;

export interface SelectContentProps {
	children: React.ReactNode;
	/**
	 * Width of the menu in px. Omit it to match the trigger's width. Set it when the trigger is compact (e.g. just a flag) and the options need more room; it is capped to the viewport.
	 */
	width?: number;
}

const OPTION_SELECTOR = '[role="option"]';

function Content({ children, width }: SelectContentProps) {
	const { open, triggerRef, contentRef, contentId, multiple, setOpen, lang } = useSelect();
	const overlayRef = useRef<HTMLButtonElement>(null);
	/**
	 * Arranca fuera de flujo e invisible: si el panel se pintara sin posicionar quedaría como
	 * bloque estático al final del `body`, alargando la página un frame (salto visual).
	 */
	const [style, setStyle] = useState<React.CSSProperties>({
		left: 0,
		opacity: 0,
		pointerEvents: 'none',
		position: 'fixed',
		top: 0,
		zIndex: 9999,
	});

	const computePosition = useCallback(() => {
		const trigger = triggerRef.current;
		if (!trigger) return;

		const rect = trigger.getBoundingClientRect();
		const viewportHeight = window.innerHeight;

		const menuWidth = width ? Math.min(width, window.innerWidth - 2 * GAP * 2) : rect.width;
		const left = width ? Math.max(GAP * 2, Math.min(rect.left, window.innerWidth - menuWidth - GAP * 2)) : rect.left;

		const spaceBelow = viewportHeight - rect.bottom - GAP;
		const spaceAbove = rect.top - GAP;

		const preferBottom = spaceBelow >= MIN_SPACE_FOR_BOTTOM || spaceBelow >= spaceAbove;

		if (preferBottom) {
			setStyle({
				left,
				maxHeight: Math.min(spaceBelow, MAX_CONTENT_HEIGHT),
				position: 'fixed',
				top: rect.bottom + GAP,
				width: menuWidth,
				zIndex: 9999,
			});
		} else {
			setStyle({
				bottom: viewportHeight - rect.top + GAP,
				left,
				maxHeight: Math.min(spaceAbove, MAX_CONTENT_HEIGHT),
				position: 'fixed',
				width: menuWidth,
				zIndex: 9999,
			});
		}
	}, [triggerRef, width]);

	useIsomorphicLayoutEffect(() => {
		if (!open) return;
		computePosition();
		window.addEventListener('scroll', computePosition, true);
		window.addEventListener('resize', computePosition);
		return () => {
			window.removeEventListener('scroll', computePosition, true);
			window.removeEventListener('resize', computePosition);
		};
	}, [open, computePosition]);

	// Opening moves focus into the menu (the search field, else the selected
	// or first option); closing hands it back to the trigger unless the
	// consumer already moved it elsewhere (e.g. to a sibling input).
	useIsomorphicLayoutEffect(() => {
		if (!open) return;
		const content = contentRef.current;
		const target = content?.querySelector<HTMLElement>('input') ?? content?.querySelector<HTMLElement>('[aria-selected="true"]') ?? content?.querySelector<HTMLElement>(OPTION_SELECTOR);
		target?.focus({
			preventScroll: true,
		});
		const trigger = triggerRef.current;
		return () => {
			const active = document.activeElement;
			if (!active || active === document.body || content?.contains(active)) {
				trigger?.focus({
					preventScroll: true,
				});
			}
		};
	}, [open, contentRef, triggerRef]);

	useEffect(() => {
		const el = overlayRef.current;
		if (!el || !open) return;
		const prevent = (e: Event) => e.preventDefault();
		el.addEventListener('wheel', prevent, {
			passive: false,
		});
		el.addEventListener('touchmove', prevent, {
			passive: false,
		});
		return () => {
			el.removeEventListener('wheel', prevent);
			el.removeEventListener('touchmove', prevent);
		};
	}, [open]);

	if (!open) return null;

	return createPortal(
		<>
			<button
				aria-label={lang.closeMenu}
				className='cursor-default'
				onClick={() => setOpen(false)}
				ref={overlayRef}
				style={{
					inset: 0,
					position: 'fixed',
					zIndex: 9998,
				}}
				tabIndex={-1}
				type='button'
			/>
			<div
				aria-multiselectable={multiple}
				className='flex flex-col overflow-hidden rounded-md border border-border bg-background shadow-md'
				id={contentId}
				onKeyDown={event => {
					if (event.key === 'Tab') {
						setOpen(false);
						return;
					}
					const options = Array.from(contentRef.current?.querySelectorAll<HTMLElement>(OPTION_SELECTOR) ?? []);
					const index = options.indexOf(document.activeElement as HTMLElement);
					const onOption = index !== -1;
					const search = contentRef.current?.querySelector<HTMLElement>('input');
					let next: HTMLElement | undefined;

					if (event.key === 'ArrowDown') {
						next = onOption ? options[index + 1] : options[0];
					} else if (event.key === 'ArrowUp') {
						if (!onOption) return;
						next = index === 0 ? (search ?? options[0]) : options[index - 1];
					} else if (event.key === 'Home' && onOption) {
						next = options[0];
					} else if (event.key === 'End' && onOption) {
						next = options[options.length - 1];
					} else {
						return;
					}

					event.preventDefault();
					next?.focus();
				}}
				ref={contentRef}
				role='listbox'
				style={style}
			>
				{children}
			</div>
		</>,
		document.body
	);
}

function ItemList({ children, className }: { children: React.ReactNode; className?: string }) {
	return <div className={cn('flex-1 overflow-y-auto p-1 scrollbar-quiet', className)}>{children}</div>;
}

function Search({ placeholder = 'Buscar…' }: { placeholder?: string }) {
	const { query, setQuery } = useSelect();

	return (
		<div className='border-b border-border p-2'>
			<div className='relative'>
				<Icon className='pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground' icon={SearchIcon} size='sm' />
				<input
					autoComplete='off'
					className={cn(
						'w-full rounded-md py-1.5 pl-8 pr-3 text-sm font-primary',
						'bg-muted border border-transparent text-foreground placeholder:text-muted-foreground',
						'focus:outline-none focus:border-ring'
					)}
					onChange={e => setQuery(e.target.value)}
					onClick={e => e.stopPropagation()}
					placeholder={placeholder}
					type='text'
					value={query}
				/>
			</div>
		</div>
	);
}

type ItemProps<T extends string> = {
	className?: string;
	classNameSelected?: string;
	value: T;
	children: React.ReactNode;
	label?: string;
};

function Item<T extends string>({ className, classNameSelected, value, children, label: labelProp }: ItemProps<T>) {
	const { multiple, value: selected, values, select, query } = useSelect();

	const searchLabel = labelProp ?? (typeof children === 'string' ? children : value);
	if (query && !searchLabel.toLowerCase().includes(query.toLowerCase())) return null;

	const isSelected = multiple ? values.includes(value) : selected === value;

	return (
		<div
			aria-selected={isSelected}
			className={cn(
				'flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm font-primary text-foreground cursor-pointer',
				'hover:bg-muted focus:bg-muted',
				'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
				isSelected && 'bg-muted font-medium',
				isSelected && classNameSelected,
				className
			)}
			onClick={() => select(value, searchLabel)}
			onKeyDown={e => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					select(value, searchLabel);
				}
			}}
			role='option'
			tabIndex={-1}
		>
			{children}
			{isSelected && <Icon aria-hidden='true' className='shrink-0 text-foreground' icon={Check} size='xs' />}
		</div>
	);
}

function Tags() {
	const { multiple, values, labels, remove, lang } = useSelect();

	if (!multiple || values.length === 0) return null;

	return (
		<div className='mt-2 flex flex-wrap gap-1'>
			{values.map(v => (
				<span className='inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-primary text-foreground' key={v}>
					{labels.get(v) ?? v}
					<button
						aria-label={lang.removeTag}
						className='cursor-pointer rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!'
						onClick={() => remove(v)}
						type='button'
					>
						<Icon icon={X} size='xs' />
					</button>
				</span>
			))}
		</div>
	);
}

/**
 * Compound select.
 * @example
 * ```tsx
 * <Select.Root defaultValue="a">
 *   <Select.Label>Country</Select.Label>
 *   <Select.Trigger><Select.Value placeholder="Choose…" /></Select.Trigger>
 *   <Select.Content>
 *     <Select.ItemList>
 *       <Select.Item value="a">Option A</Select.Item>
 *     </Select.ItemList>
 *   </Select.Content>
 * </Select.Root>
 * ```
 */
export const Select = {
	Content,
	Item,
	ItemList,
	Label,
	Root,
	Search,
	Tags,
	Trigger,
	Value,
};
