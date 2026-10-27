'use client';

import { Check, ChevronDown, LoaderCircle, Plus, X } from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Tag } from '../../data-display/tag/tag';
import { Icon } from '../../foundations/icon/icon';
import { cn } from '../../utils/tailwind/cn';

type ComboboxFilter = (label: string, query: string) => boolean;

const defaultFilter: ComboboxFilter = (label, query) => label.toLowerCase().includes(query.trim().toLowerCase());

/** Texts rendered by `Combobox`'s subcomponents that have no override prop of their own. Pass `lang` to `Combobox` to override any of them. */
export interface ComboboxLang {
	/** Accessible label for the "clear selection" button. */
	clearSelection: string;
	/** Accessible label for the "toggle options" button. */
	toggleOptions: string;
	/** Accessible label for the options listbox. */
	options: string;
	/** Accessible label for a selected tag's remove button, in `multiple` mode. */
	removeTag: (label: string) => string;
}

/** English defaults for `ComboboxLang`. */
export const defaultComboboxLang: ComboboxLang = {
	clearSelection: 'Clear selection',
	options: 'Options',
	removeTag: label => `Remove ${label}`,
	toggleOptions: 'Toggle options',
};

interface ComboboxContextValue {
	lang: ComboboxLang;
	multiple: boolean;
	disabled: boolean;
	loading: boolean;
	filter: false | ComboboxFilter;
	onCreate?: (text: string) => void;
	values: string[];
	getLabel: (value: string) => string;
	registerItem: (value: string, label: string) => void;
	reportVisible: (value: string, visible: boolean) => void;
	visibleValues: () => string[];
	/** Bumps whenever the set of visible items changes, so consumers re-render. */
	visibleVersion: number;
	select: (value: string) => void;
	remove: (value: string) => void;
	clear: () => void;
	/** Text currently shown in the input. */
	displayValue: string;
	/** Text items are filtered by (empty until the user types, in single mode). */
	query: string;
	handleInput: (text: string) => void;
	resetInput: () => void;
	open: boolean;
	setOpen: (open: boolean) => void;
	activeId: string | undefined;
	setActiveId: (id: string | undefined) => void;
	inputRef: React.RefObject<HTMLInputElement | null>;
	anchorRef: React.RefObject<HTMLDivElement | null>;
	listboxRef: React.RefObject<HTMLDivElement | null>;
	listboxId: string;
	inputId: string;
	labelId: string;
	errorId: string;
	errorMessage: string | undefined;
	createId: string;
}

const ComboboxContext = React.createContext<ComboboxContextValue | null>(null);

function useComboboxContext() {
	const context = React.useContext(ComboboxContext);
	if (!context) {
		throw new Error('Combobox subcomponents must be used within <Combobox>.');
	}
	return context;
}

interface ComboboxBaseProps {
	children: React.ReactNode;
	/** Open state of the options panel, for controlled usage. */
	open?: boolean;
	/**
	 * Initial open state, for uncontrolled usage.
	 * @default false
	 */
	defaultOpen?: boolean;
	/** Called whenever the panel opens or closes, controlled or not. */
	onOpenChange?: (open: boolean) => void;
	/** Called with the text the user types. Use it to fetch options from a server, together with `filter={false}` and `loading`. */
	onInputChange?: (text: string) => void;
	/**
	 * How items are matched against the typed text. Receives an item's label and the query; return `true` to keep it. Pass `false` to disable filtering (the items you render are already the matches, e.g. server-side search).
	 * @default case-insensitive "contains"
	 */
	filter?: false | ComboboxFilter;
	/**
	 * Shows a spinner and a "Loading…" row while options are being fetched.
	 * @default false
	 */
	loading?: boolean;
	/** Turns on creating values: when the typed text matches no option, a "Create “text”" row appears and picking it calls this with the text. It's up to you to add the option and, if you want it selected, update `value`. */
	onCreate?: (text: string) => void;
	/**
	 * Disables the field.
	 * @default false
	 */
	disabled?: boolean;
	/** Error text shown below the field; also sets `aria-invalid` and `aria-describedby` on the input. */
	errorMessage?: string;
	/**
	 * Texts rendered by subcomponents that have no override prop of their own. Merges over English defaults.
	 * @default defaultComboboxLang
	 */
	lang?: Partial<ComboboxLang>;
	className?: string;
}

export interface ComboboxSingleProps extends ComboboxBaseProps {
	/**
	 * Pick one option.
	 * @default false
	 */
	multiple?: false;
	/** Selected value (`null` for none), for controlled usage. */
	value?: string | null;
	/** Initial value, for uncontrolled usage. */
	defaultValue?: string | null;
	/** Called with the picked value, or `null` when it's cleared. */
	onValueChange?: (value: string | null) => void;
}

export interface ComboboxMultipleProps extends ComboboxBaseProps {
	/** Pick several options; they're shown as removable tags inside the field. */
	multiple: true;
	/** Selected values, for controlled usage. */
	value?: string[];
	/**
	 * Initial values, for uncontrolled usage.
	 * @default []
	 */
	defaultValue?: string[];
	/** Called with the full list whenever an option is picked or removed. */
	onValueChange?: (values: string[]) => void;
}

export type ComboboxProps = ComboboxSingleProps | ComboboxMultipleProps;

/**
 * Compound combobox — a text field you type into to filter a list of options
 * and pick from it (WAI-ARIA combobox + listbox pattern). Unlike `Select`
 * (a button that opens a list), the field itself is editable, and it supports
 * async options (`loading`, `filter={false}`), creating values (`onCreate`)
 * and `multiple` selection shown as `Tag`s. Options load in the background
 * even while closed, so a selected value can always show its label.
 * @example
 * ```tsx
 * <Combobox onValueChange={setFramework}>
 *   <Combobox.Label>Framework</Combobox.Label>
 *   <Combobox.Input placeholder="Search…" />
 *   <Combobox.Content>
 *     <Combobox.Item value="next">Next.js</Combobox.Item>
 *     <Combobox.Item value="remix">Remix</Combobox.Item>
 *   </Combobox.Content>
 * </Combobox>
 * ```
 */
function ComboboxRoot(props: ComboboxProps) {
	const {
		children,
		open: controlledOpen,
		defaultOpen = false,
		onOpenChange,
		onInputChange,
		filter = defaultFilter,
		loading = false,
		onCreate,
		disabled = false,
		errorMessage,
		lang,
		className,
	} = props;
	const resolvedLang = { ...defaultComboboxLang, ...lang };
	const multiple = props.multiple === true;

	const baseId = React.useId();
	const inputId = `${baseId}-input`;
	const listboxId = `${baseId}-listbox`;
	const labelId = `${baseId}-label`;
	const errorId = `${baseId}-error`;
	const createId = `${baseId}-create`;
	const inputRef = React.useRef<HTMLInputElement>(null);
	const anchorRef = React.useRef<HTMLDivElement>(null);
	const listboxRef = React.useRef<HTMLDivElement>(null);

	// ── open ───────────────────────────────────────────────────────────────
	const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
	const isOpenControlled = controlledOpen !== undefined;
	const open = isOpenControlled ? controlledOpen : internalOpen;
	const setOpen = React.useCallback(
		(next: boolean) => {
			if (!isOpenControlled) setInternalOpen(next);
			onOpenChange?.(next);
		},
		[isOpenControlled, onOpenChange]
	);

	// ── value ──────────────────────────────────────────────────────────────
	const normalize = (raw: string | string[] | null | undefined) => (Array.isArray(raw) ? raw : raw ? [raw] : []);
	const [internalValues, setInternalValues] = React.useState(() => normalize(props.defaultValue));
	const isValueControlled = props.value !== undefined;
	const values = isValueControlled ? normalize(props.value) : internalValues;
	const valuesRef = React.useRef(values);
	valuesRef.current = values;

	const commit = React.useCallback(
		(next: string[]) => {
			if (!isValueControlled) setInternalValues(next);
			if (multiple) (props.onValueChange as ((v: string[]) => void) | undefined)?.(next);
			else (props.onValueChange as ((v: string | null) => void) | undefined)?.(next[0] ?? null);
		},
		[isValueControlled, multiple, props.onValueChange]
	);

	// ── text ───────────────────────────────────────────────────────────────
	const [inputValue, setInputValue] = React.useState('');
	// In single mode the input shows the selected label until the user types.
	const [dirty, setDirty] = React.useState(false);

	// ── item registry (labels + which items currently match) ───────────────
	const labelsRef = React.useRef(new Map<string, string>());
	const visibleRef = React.useRef(new Set<string>());
	const [visibleVersion, bump] = React.useReducer((n: number) => n + 1, 0);

	const registerItem = React.useCallback((value: string, label: string) => {
		if (labelsRef.current.get(value) === label) return;
		labelsRef.current.set(value, label);
		bump();
	}, []);
	const reportVisible = React.useCallback((value: string, visible: boolean) => {
		const set = visibleRef.current;
		if (visible === set.has(value)) return;
		if (visible) set.add(value);
		else set.delete(value);
		bump();
	}, []);
	const getLabel = React.useCallback((value: string) => labelsRef.current.get(value) ?? value, []);
	const visibleValues = React.useCallback(() => [...visibleRef.current], []);

	// ── actions ────────────────────────────────────────────────────────────
	const resetInput = React.useCallback(() => {
		setInputValue('');
		setDirty(false);
	}, []);

	const select = React.useCallback(
		(value: string) => {
			if (multiple) {
				const current = valuesRef.current;
				commit(current.includes(value) ? current.filter(v => v !== value) : [...current, value]);
				resetInput();
				inputRef.current?.focus();
			} else {
				commit([value]);
				resetInput();
				setOpen(false);
			}
		},
		[commit, multiple, resetInput, setOpen]
	);

	const remove = React.useCallback((value: string) => commit(valuesRef.current.filter(v => v !== value)), [commit]);

	const clear = React.useCallback(() => {
		commit([]);
		resetInput();
		inputRef.current?.focus();
	}, [commit, resetInput]);

	const handleInput = React.useCallback(
		(text: string) => {
			setInputValue(text);
			setDirty(true);
			setOpen(true);
			onInputChange?.(text);
		},
		[onInputChange, setOpen]
	);

	const [activeId, setActiveId] = React.useState<string>();
	const query = multiple || dirty ? inputValue : '';
	const displayValue = multiple || dirty ? inputValue : values[0] !== undefined ? getLabel(values[0]) : '';

	// Highlight the selected option (or the first one) whenever the list
	// changes or opens; the DOM is the source of truth for what's navigable.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `query`/`visibleVersion` are the triggers, not values read here.
	React.useEffect(() => {
		if (!open) {
			setActiveId(undefined);
			return;
		}
		const options = listboxRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])');
		const target = options && ([...options].find(option => option.getAttribute('aria-selected') === 'true') ?? options[0]);
		setActiveId(target?.id);
	}, [open, query, visibleVersion, loading]);

	React.useEffect(() => {
		if (!activeId) return;
		document.getElementById(activeId)?.scrollIntoView?.({
			block: 'nearest',
		});
	}, [activeId]);

	const contextValue = React.useMemo<ComboboxContextValue>(
		() => ({
			activeId,
			anchorRef,
			clear,
			createId,
			disabled,
			displayValue,
			errorId,
			errorMessage,
			filter,
			getLabel,
			handleInput,
			inputId,
			inputRef,
			labelId,
			lang: resolvedLang,
			listboxId,
			listboxRef,
			loading,
			multiple,
			onCreate,
			open,
			query,
			registerItem,
			remove,
			reportVisible,
			resetInput,
			select,
			setActiveId,
			setOpen,
			values,
			visibleValues,
			visibleVersion,
		}),
		[
			activeId,
			clear,
			createId,
			disabled,
			displayValue,
			errorId,
			errorMessage,
			filter,
			getLabel,
			handleInput,
			inputId,
			labelId,
			resolvedLang,
			listboxId,
			loading,
			multiple,
			onCreate,
			open,
			query,
			registerItem,
			remove,
			reportVisible,
			resetInput,
			select,
			setOpen,
			values,
			visibleValues,
			visibleVersion,
		]
	);

	return (
		<ComboboxContext.Provider value={contextValue}>
			<div className={cn('flex w-full flex-col gap-1.5', className)}>
				{children}
				{errorMessage && (
					<p className='font-primary text-xs text-destructive' id={errorId} role='alert'>
						{errorMessage}
					</p>
				)}
			</div>
		</ComboboxContext.Provider>
	);
}

export interface ComboboxLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {}

/** Label of the field; clicking it focuses the input. */
function ComboboxLabel({ className, ...props }: ComboboxLabelProps) {
	const { inputId, labelId } = useComboboxContext();
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: wired to the input through `htmlFor`.
		<label className={cn('font-primary text-sm font-medium text-foreground', className)} htmlFor={inputId} id={labelId} {...props} />
	);
}

export interface ComboboxInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'role'> {
	/**
	 * Shows a × button that clears the selection while there is one.
	 * @default true
	 */
	clearable?: boolean;
	/** Classes for the bordered container that holds the tags, the input and the buttons. */
	containerClassName?: string;
}

/** The editable field: selected tags (multiple mode), the text input and the clear/chevron buttons. Owns the keyboard: ↓/↑ move through options, Enter picks, Esc closes, Backspace on an empty field removes the last tag. */
function ComboboxInput({ clearable = true, className, containerClassName, placeholder, onKeyDown, onBlur, onClick, ...props }: ComboboxInputProps) {
	const {
		multiple,
		disabled,
		loading,
		values,
		getLabel,
		remove,
		clear,
		displayValue,
		handleInput,
		resetInput,
		open,
		setOpen,
		activeId,
		setActiveId,
		inputRef,
		anchorRef,
		listboxRef,
		listboxId,
		inputId,
		lang,
		errorId,
		errorMessage,
	} = useComboboxContext();

	const move = (step: 1 | -1) => {
		const options = [...(listboxRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? [])];
		if (options.length === 0) return;
		const current = options.findIndex(option => option.id === activeId);
		const next = current === -1 ? (step === 1 ? 0 : options.length - 1) : (current + step + options.length) % options.length;
		setActiveId(options[next]?.id);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		onKeyDown?.(event);
		if (event.defaultPrevented) return;

		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				event.preventDefault();
				if (!open) setOpen(true);
				else move(event.key === 'ArrowDown' ? 1 : -1);
				break;
			case 'Enter':
				if (!open) return;
				// Never submit a surrounding form while the list is open.
				event.preventDefault();
				if (activeId) document.getElementById(activeId)?.click();
				break;
			case 'Escape':
				if (!open) return;
				event.preventDefault();
				event.stopPropagation();
				setOpen(false);
				resetInput();
				break;
			case 'Backspace': {
				const last = values[values.length - 1];
				if (multiple && displayValue === '' && last !== undefined) remove(last);
				break;
			}
		}
	};

	const hasValue = values.length > 0;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: forwards a click on the box's padding to the input, which stays the real keyboard target.
		// biome-ignore lint/a11y/useKeyWithClickEvents: same — keyboard users interact with the input itself.
		<div
			className={cn(
				'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1 transition-colors duration-150 ease-in-out focus-within:border-ring',
				disabled && 'cursor-not-allowed opacity-50',
				errorMessage && 'border-destructive',
				containerClassName
			)}
			onClick={() => inputRef.current?.focus()}
			ref={anchorRef}
		>
			{multiple &&
				values.map(value => (
					<Tag disabled={disabled} key={value} size='sm'>
						<Tag.Text>{getLabel(value)}</Tag.Text>
						<Tag.Remove
							label={lang.removeTag(getLabel(value))}
							onClick={event => {
								event.stopPropagation();
								remove(value);
								inputRef.current?.focus();
							}}
						/>
					</Tag>
				))}
			<input
				aria-activedescendant={open ? activeId : undefined}
				aria-autocomplete='list'
				aria-controls={listboxId}
				aria-describedby={errorMessage ? errorId : undefined}
				aria-expanded={open}
				aria-invalid={errorMessage ? true : undefined}
				autoComplete='off'
				className={cn('min-w-24 flex-1 bg-transparent py-1 font-primary text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed', className)}
				disabled={disabled}
				id={inputId}
				onBlur={event => {
					onBlur?.(event);
					setOpen(false);
					resetInput();
				}}
				onChange={event => handleInput(event.target.value)}
				onClick={event => {
					onClick?.(event);
					if (!open) setOpen(true);
				}}
				onKeyDown={handleKeyDown}
				placeholder={multiple && hasValue ? undefined : placeholder}
				ref={inputRef}
				role='combobox'
				type='text'
				value={displayValue}
				{...props}
			/>
			{loading && <Icon aria-hidden='true' className='shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none' icon={LoaderCircle} size='sm' />}
			{clearable && hasValue && !disabled && (
				<button
					aria-label={lang.clearSelection}
					className='flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 ease-in-out hover:text-foreground focus-visible:outline-2! focus-visible:outline-offset-1! focus-visible:outline-ring!'
					onClick={event => {
						event.stopPropagation();
						clear();
					}}
					type='button'
				>
					<Icon aria-hidden='true' icon={X} size='sm' />
				</button>
			)}
			<button
				aria-label={lang.toggleOptions}
				className='flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 ease-in-out hover:text-foreground disabled:cursor-not-allowed'
				disabled={disabled}
				onClick={event => {
					event.stopPropagation();
					inputRef.current?.focus();
					setOpen(!open);
				}}
				// Keep focus in the input so the field doesn't blur (and close) first.
				onMouseDown={event => event.preventDefault()}
				tabIndex={-1}
				type='button'
			>
				<Icon aria-hidden='true' className={cn('transition-transform duration-150 ease-in-out', open && 'rotate-180')} icon={ChevronDown} size='sm' />
			</button>
		</div>
	);
}

const GAP = 4;
const MAX_CONTENT_HEIGHT = 256;
const MIN_SPACE_FOR_BOTTOM = 120;

export interface ComboboxContentProps {
	/** The `Combobox.Item`s to choose from. */
	children: React.ReactNode;
	/**
	 * Text of the row shown when nothing matches the typed text.
	 * @default "No results found."
	 */
	emptyMessage?: string;
	/**
	 * Text of the row shown while `loading`.
	 * @default "Loading…"
	 */
	loadingMessage?: string;
	/** Builds the label of the create row from the typed text. Only used with `onCreate`. @default `Create “${text}”` */
	createLabel?: (text: string) => React.ReactNode;
	className?: string;
}

/**
 * The options panel, portaled to `document.body` and positioned under the
 * field (flipping above when there isn't room). Stays mounted while closed
 * (hidden) so items can register their labels; also hosts the "no results",
 * "loading" and "create" rows.
 */
function ComboboxContent({ children, emptyMessage = 'No results found.', loadingMessage = 'Loading…', createLabel = text => `Create “${text}”`, className }: ComboboxContentProps) {
	const {
		open,
		anchorRef,
		listboxRef,
		listboxId,
		multiple,
		loading,
		query,
		onCreate,
		createId,
		activeId,
		setActiveId,
		visibleValues,
		visibleVersion,
		getLabel,
		resetInput,
		setOpen,
		inputRef,
		lang,
	} = useComboboxContext();
	const [mounted, setMounted] = React.useState(false);
	const [style, setStyle] = React.useState<React.CSSProperties>({
		left: 0,
		position: 'fixed',
		top: 0,
	});

	React.useEffect(() => setMounted(true), []);

	const computePosition = React.useCallback(() => {
		const anchor = anchorRef.current;
		if (!anchor) return;
		const rect = anchor.getBoundingClientRect();
		const spaceBelow = window.innerHeight - rect.bottom - GAP;
		const spaceAbove = rect.top - GAP;
		const preferBottom = spaceBelow >= MIN_SPACE_FOR_BOTTOM || spaceBelow >= spaceAbove;

		setStyle(
			preferBottom
				? {
						left: rect.left,
						maxHeight: Math.min(spaceBelow, MAX_CONTENT_HEIGHT),
						position: 'fixed',
						top: rect.bottom + GAP,
						width: rect.width,
					}
				: {
						bottom: window.innerHeight - rect.top + GAP,
						left: rect.left,
						maxHeight: Math.min(spaceAbove, MAX_CONTENT_HEIGHT),
						position: 'fixed',
						width: rect.width,
					}
		);
	}, [anchorRef]);

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

	if (!mounted) return null;

	// `visibleVersion` re-renders this when items report matching.
	void visibleVersion;
	const visible = visibleValues();
	const text = query.trim();
	const showCreate = Boolean(onCreate) && text !== '' && !visible.some(value => getLabel(value).toLowerCase() === text.toLowerCase());
	const showEmpty = visible.length === 0 && !loading && !showCreate;

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: only stops mousedown from blurring the input; the options are operated through the combobox.
		<div
			className={cn('z-9999 flex flex-col overflow-hidden rounded-md border border-border bg-background shadow-md', className)}
			hidden={!open}
			// Clicks inside the panel (incl. its scrollbar) must not blur the input.
			onMouseDown={event => event.preventDefault()}
			style={style}
		>
			<div
				aria-busy={loading}
				aria-label={lang.options}
				aria-multiselectable={multiple || undefined}
				className='flex-1 overflow-y-auto p-1 scrollbar-quiet'
				id={listboxId}
				ref={listboxRef}
				role='listbox'
			>
				{children}
				{showCreate && (
					// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the input (activedescendant), not by the option.
					<div
						aria-selected={false}
						className={cn('flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 font-primary text-sm text-foreground', activeId === createId && 'bg-muted')}
						id={createId}
						onClick={() => {
							onCreate?.(text);
							resetInput();
							if (!multiple) setOpen(false);
							inputRef.current?.focus();
						}}
						onMouseMove={() => setActiveId(createId)}
						role='option'
						tabIndex={-1}
					>
						<Icon aria-hidden='true' className='shrink-0 text-muted-foreground' icon={Plus} size='sm' />
						<span className='truncate'>{createLabel(text)}</span>
					</div>
				)}
				{loading && (
					<div aria-disabled='true' className='px-3 py-2 font-primary text-sm text-muted-foreground' role='option' tabIndex={-1}>
						{loadingMessage}
					</div>
				)}
				{showEmpty && (
					<div aria-disabled='true' className='px-3 py-2 font-primary text-sm text-muted-foreground' role='option' tabIndex={-1}>
						{emptyMessage}
					</div>
				)}
			</div>
		</div>,
		document.body
	);
}

export interface ComboboxItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> {
	/** Unique value of the option, reported through `onValueChange`. */
	value: string;
	/** Text used to filter the option and to label it in the field and tags. Defaults to `children` when that is a string, else to `value`. */
	label?: string;
	/**
	 * Makes the option unselectable and skipped by keyboard navigation.
	 * @default false
	 */
	disabled?: boolean;
}

/** One option. Hides itself when it doesn't match the typed text, registers its label with the root, and shows a check when selected. */
function ComboboxItem({ value, label: labelProp, disabled = false, className, children, onClick, ...props }: ComboboxItemProps) {
	const { values, filter, query, select, registerItem, reportVisible, activeId, setActiveId } = useComboboxContext();
	const id = React.useId();
	const label = labelProp ?? (typeof children === 'string' ? children : value);
	const matches = filter === false ? true : filter(label, query);
	const selected = values.includes(value);

	React.useEffect(() => {
		registerItem(value, label);
	}, [registerItem, value, label]);

	React.useEffect(() => {
		reportVisible(value, matches);
		return () => reportVisible(value, false);
	}, [reportVisible, value, matches]);

	if (!matches) return null;

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the input (activedescendant), not by the option.
		<div
			aria-disabled={disabled || undefined}
			aria-selected={selected}
			className={cn(
				'flex cursor-pointer items-center justify-between gap-2 rounded-sm px-3 py-2 font-primary text-sm text-foreground',
				activeId === id && 'bg-muted',
				selected && 'font-medium',
				disabled && 'cursor-not-allowed opacity-50',
				className
			)}
			id={id}
			onClick={event => {
				onClick?.(event);
				if (!disabled) select(value);
			}}
			onMouseMove={() => !disabled && setActiveId(id)}
			role='option'
			tabIndex={-1}
			{...props}
		>
			<span className='truncate'>{children}</span>
			{selected && <Icon aria-hidden='true' className='shrink-0' icon={Check} size='xs' />}
		</div>
	);
}

export const Combobox = Object.assign(ComboboxRoot, {
	Content: ComboboxContent,
	Input: ComboboxInput,
	Item: ComboboxItem,
	Label: ComboboxLabel,
});
