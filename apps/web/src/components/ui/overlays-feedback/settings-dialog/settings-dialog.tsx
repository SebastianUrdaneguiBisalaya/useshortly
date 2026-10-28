'use client';

import { type LucideIcon, Search, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '../../actions-controls/button/button';
import { Input } from '../../forms-inputs/input/input';
import { Icon } from '../../foundations/icon/icon';
import { cn } from '../../utils/tailwind/cn';
import { Modal } from '../modal/modal';

/** Texts rendered by `SettingsDialog` itself. Pass `lang` to `SettingsDialog.Root` to override any of them. */
export interface SettingsDialogLang {
	/** Accessible name of the dialog, used when `SettingsDialog.Content` has no `title` prop. */
	title: string;
	/** Placeholder (and accessible name) of the sidebar search field. */
	searchPlaceholder: string;
	/** Message shown in the sidebar when the search matches no item. */
	noResults: string;
	/** Accessible name of the close button. */
	close: string;
}

/** English defaults for `SettingsDialogLang`. */
export const defaultSettingsDialogLang: SettingsDialogLang = {
	close: 'Close',
	noResults: 'No results',
	searchPlaceholder: 'Search',
	title: 'Settings',
};

interface SettingsDialogContextValue {
	readonly lang: SettingsDialogLang;
	readonly baseId: string;
	readonly titleId: string;
	readonly value: string;
	readonly setValue: (value: string) => void;
	readonly query: string;
	readonly setQuery: (query: string) => void;
}

const SettingsDialogContext = React.createContext<SettingsDialogContextValue | null>(null);

function useSettingsDialogContext() {
	const context = React.useContext(SettingsDialogContext);
	if (!context) {
		throw new Error('SettingsDialog subcomponents must be used within <SettingsDialog.Root>.');
	}
	return context;
}

/** Concatenates the text found in a React node tree, for matching the sidebar search. */
function textOf(node: React.ReactNode): string {
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) return node.map(textOf).join(' ');
	if (
		React.isValidElement<{
			children?: React.ReactNode;
		}>(node)
	) {
		return textOf(node.props.children);
	}
	return '';
}

export interface SettingsDialogRootProps {
	children: React.ReactNode;
	/** Active section value, for controlled usage. Must match a `SettingsDialog.Item`/`SettingsDialog.Panel` `value`. */
	value?: string;
	/** Initially active section, for uncontrolled usage. */
	defaultValue?: string;
	/** Called with the new value whenever the active section changes. */
	onValueChange?: (value: string) => void;
	/** Open state, for controlled usage. */
	open?: boolean;
	/** Initial open state, for uncontrolled usage. @default false */
	defaultOpen?: boolean;
	/** Called whenever the open state changes, controlled or not. */
	onOpenChange?: (open: boolean) => void;
	/**
	 * Texts rendered by the dialog. Merges over English defaults.
	 * @default defaultSettingsDialogLang
	 */
	lang?: Partial<SettingsDialogLang>;
}

/**
 * Compound settings dialog — a large modal with a searchable, vertical
 * navigation on the left and one panel on the right. The dialog owns the
 * navigation, search and focus behavior; the content of every panel is
 * whatever you pass as `SettingsDialog.Panel` children. Built on `Modal`
 * (overlay, focus trap, Escape, stacking).
 * @example
 * ```tsx
 * <SettingsDialog.Root defaultValue="general">
 *   <SettingsDialog.Trigger>
 *     <Button><Button.Text>Settings</Button.Text></Button>
 *   </SettingsDialog.Trigger>
 *   <SettingsDialog.Content>
 *     <SettingsDialog.Sidebar>
 *       <SettingsDialog.Search />
 *       <SettingsDialog.Nav>
 *         <SettingsDialog.Group label="Settings">
 *           <SettingsDialog.Item value="general" icon={Settings}>General</SettingsDialog.Item>
 *         </SettingsDialog.Group>
 *       </SettingsDialog.Nav>
 *     </SettingsDialog.Sidebar>
 *     <SettingsDialog.Main>
 *       <SettingsDialog.Panel value="general">
 *         <SettingsDialog.Section title="Appearance">
 *           <SettingsDialog.Row label="Theme">...</SettingsDialog.Row>
 *         </SettingsDialog.Section>
 *       </SettingsDialog.Panel>
 *     </SettingsDialog.Main>
 *   </SettingsDialog.Content>
 * </SettingsDialog.Root>
 * ```
 */
function SettingsDialogRoot({ children, value: controlledValue, defaultValue = '', onValueChange, open, defaultOpen, onOpenChange, lang }: SettingsDialogRootProps) {
	const baseId = React.useId();
	const titleId = React.useId();
	const [internalValue, setInternalValue] = React.useState(defaultValue);
	const [query, setQuery] = React.useState('');
	const value = controlledValue !== undefined ? controlledValue : internalValue;

	const setValue = React.useCallback(
		(next: string) => {
			if (controlledValue === undefined) setInternalValue(next);
			onValueChange?.(next);
		},
		[controlledValue, onValueChange]
	);

	const resolvedLang = React.useMemo(
		() => ({
			...defaultSettingsDialogLang,
			...lang,
		}),
		[lang]
	);

	const context = React.useMemo<SettingsDialogContextValue>(
		() => ({
			baseId,
			lang: resolvedLang,
			query,
			setQuery,
			setValue,
			titleId,
			value,
		}),
		[baseId, query, resolvedLang, setValue, titleId, value]
	);

	return (
		<SettingsDialogContext.Provider value={context}>
			<Modal.Root defaultOpen={defaultOpen} onOpenChange={onOpenChange} open={open}>
				{children}
			</Modal.Root>
		</SettingsDialogContext.Provider>
	);
}

export interface SettingsDialogTriggerProps {
	/** A single element (e.g. a `Button`) that opens the dialog on click. */
	children: React.ReactElement<{
		onClick?: (event: React.MouseEvent<HTMLElement>) => void;
	}>;
}

/** Clones `children` and wires an `onClick` that opens the dialog. */
function SettingsDialogTrigger({ children }: SettingsDialogTriggerProps) {
	return <Modal.Trigger>{children}</Modal.Trigger>;
}

export interface SettingsDialogContentProps {
	/** Usually a `SettingsDialog.Sidebar` followed by a `SettingsDialog.Main`. */
	children: React.ReactNode;
	/** Accessible name of the dialog, rendered visually hidden. @default lang.title */
	title?: string;
	/** Additional classes for the dialog surface. */
	className?: string;
}

/** Portaled `dialog` surface laid out as sidebar + main. Fixed-height and wide so switching sections never resizes it; renders the close button in the top-right corner. */
function SettingsDialogContent({ children, title, className }: SettingsDialogContentProps) {
	const { lang, titleId } = useSettingsDialogContext();

	return (
		<Modal.Content aria-labelledby={titleId} className={cn('flex h-[min(44rem,calc(100dvh-3rem))] max-w-4xl flex-col overflow-hidden p-0 md:flex-row', className)}>
			<h2 className='sr-only' id={titleId}>
				{title ?? lang.title}
			</h2>
			{children}
			<Modal.Close>
				<Button aria-label={lang.close} className='absolute top-3 right-3' size='icon' type='button' variant='ghost'>
					<Button.Icon aria-hidden='true' icon={X} />
				</Button>
			</Modal.Close>
		</Modal.Content>
	);
}

export interface SettingsDialogSidebarProps extends React.HTMLAttributes<HTMLElement> {}

/** Left column holding the search field and the navigation. Stacks above the panel on small screens. */
function SettingsDialogSidebar({ className, ...props }: SettingsDialogSidebarProps) {
	return <aside className={cn('flex max-h-56 shrink-0 flex-col gap-4 overflow-y-auto border-b border-border p-3 md:max-h-none md:w-64 md:border-r md:border-b-0', className)} {...props} />;
}

export interface SettingsDialogSearchProps {
	/** Additional classes for the search field's wrapper. */
	className?: string;
}

/** Search field that filters the `SettingsDialog.Item`s by their text and `keywords`. */
function SettingsDialogSearch({ className }: SettingsDialogSearchProps) {
	const { lang, query, setQuery } = useSettingsDialogContext();

	return (
		<Input className={className}>
			<Input.Icon icon={Search} />
			<Input.Field aria-label={lang.searchPlaceholder} autoComplete='off' onChange={event => setQuery(event.target.value)} placeholder={lang.searchPlaceholder} type='search' value={query} />
		</Input>
	);
}

export interface SettingsDialogNavProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Accessible name of the navigation. @default lang.title */
	'aria-label'?: string;
}

function focusItem(list: HTMLElement, index: number) {
	const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
	if (tabs.length === 0) return;
	const target = tabs[((index % tabs.length) + tabs.length) % tabs.length];
	target.focus();
	return target.dataset.value;
}

/** Vertical `tablist` wrapping the `SettingsDialog.Group`s and `SettingsDialog.Item`s. Arrow Up/Down, Home and End move between visible items and activate them. */
function SettingsDialogNav({ className, children, 'aria-label': ariaLabel, ...props }: SettingsDialogNavProps) {
	const { lang, setValue } = useSettingsDialogContext();

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const list = event.currentTarget;
		const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
		const index = tabs.indexOf(document.activeElement as HTMLElement);
		if (index === -1) return;

		let next: string | undefined;
		if (event.key === 'ArrowDown') next = focusItem(list, index + 1);
		else if (event.key === 'ArrowUp') next = focusItem(list, index - 1);
		else if (event.key === 'Home') next = focusItem(list, 0);
		else if (event.key === 'End') next = focusItem(list, tabs.length - 1);

		if (next !== undefined) {
			event.preventDefault();
			setValue(next);
		}
	};

	return (
		<div className='group/nav flex flex-col'>
			<div aria-label={ariaLabel ?? lang.title} aria-orientation='vertical' className={cn('flex flex-col gap-4', className)} onKeyDown={handleKeyDown} role='tablist' {...props}>
				{children}
			</div>
			<p className='hidden px-3 py-2 font-primary text-sm text-muted-foreground group-not-has-[[role=tab]]/nav:block'>{lang.noResults}</p>
		</div>
	);
}

export interface SettingsDialogGroupProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Small caption above the group's items (e.g. "Settings", "Customize"). */
	label?: string;
}

/** Visual group of items under a caption. Hides itself when the search filters out all of its items. */
function SettingsDialogGroup({ label, className, children, ...props }: SettingsDialogGroupProps) {
	return (
		<div className={cn('flex flex-col gap-0.5 not-has-[[role=tab]]:hidden', className)} role='presentation' {...props}>
			{label && (
				<span aria-hidden='true' className='px-3 pb-1 font-primary text-xs text-muted-foreground'>
					{label}
				</span>
			)}
			{children}
		</div>
	);
}

export interface SettingsDialogItemProps {
	/** Value this item activates; must match a `SettingsDialog.Panel`'s `value`. */
	value: string;
	/** Label of the item; also what the search matches against. */
	children: React.ReactNode;
	/** Optional leading icon. */
	icon?: LucideIcon;
	/** Extra search terms that match this item without being displayed. */
	keywords?: string[];
	/** Additional classes for the item. */
	className?: string;
}

/** Vertical tab. Selecting it shows the `SettingsDialog.Panel` with the same `value`. Renders nothing while the search excludes it. */
function SettingsDialogItem({ value, children, icon, keywords, className }: SettingsDialogItemProps) {
	const { baseId, value: currentValue, setValue, query } = useSettingsDialogContext();
	const active = currentValue === value;

	const needle = query.trim().toLowerCase();
	if (needle) {
		const haystack = [textOf(children), ...(keywords ?? [])].join(' ').toLowerCase();
		if (!haystack.includes(needle)) return null;
	}

	return (
		<button
			aria-controls={`${baseId}-panel-${value}`}
			aria-selected={active}
			className={cn(
				'group flex w-full cursor-pointer flex-row items-center gap-2 rounded-md px-3 py-2 text-left font-primary text-sm font-medium transition-colors duration-150 ease-in-out',
				'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
				active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
				className
			)}
			data-value={value}
			id={`${baseId}-tab-${value}`}
			onClick={() => setValue(value)}
			role='tab'
			tabIndex={active ? 0 : -1}
			type='button'
		>
			{icon && <Icon aria-hidden='true' className='shrink-0' icon={icon} size='sm' />}
			<span className='truncate'>{children}</span>
		</button>
	);
}

export interface SettingsDialogMainProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Scrollable right column that holds the `SettingsDialog.Panel`s. */
function SettingsDialogMain({ className, ...props }: SettingsDialogMainProps) {
	return <div className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6 md:px-8', className)} {...props} />;
}

export interface SettingsDialogPanelProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Value of the `SettingsDialog.Item` that shows this panel. */
	value: string;
}

/** Content of one section. Only the active panel is rendered; what goes inside is entirely up to you. */
function SettingsDialogPanel({ value, className, ...props }: SettingsDialogPanelProps) {
	const { baseId, value: currentValue } = useSettingsDialogContext();
	if (currentValue !== value) return null;

	return (
		<div
			aria-labelledby={`${baseId}-tab-${value}`}
			className={cn('flex flex-col gap-8 pr-8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', className)}
			id={`${baseId}-panel-${value}`}
			role='tabpanel'
			// biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA Tabs pattern makes the tabpanel focusable so keyboard users can reach its content.
			tabIndex={0}
			{...props}
		/>
	);
}

export interface SettingsDialogSectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
	/** Heading of the section (e.g. "Appearance"). */
	title: React.ReactNode;
}

/** Titled block of related `SettingsDialog.Row`s inside a panel. */
function SettingsDialogSection({ title, className, children, ...props }: SettingsDialogSectionProps) {
	return (
		<section className={cn('flex flex-col', className)} {...props}>
			<h3 className='pb-2 font-primary text-base font-semibold text-foreground'>{title}</h3>
			<div className='flex flex-col divide-y divide-border'>{children}</div>
		</section>
	);
}

export interface SettingsDialogRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
	/** Name of the setting. */
	label: React.ReactNode;
	/** Optional helper text under the label. */
	description?: React.ReactNode;
	/** The control (select, toggle, segmented control…) rendered at the end of the row. */
	children?: React.ReactNode;
}

/** One setting: label and description on the left, the control passed as `children` on the right. */
function SettingsDialogRow({ label, description, className, children, ...props }: SettingsDialogRowProps) {
	return (
		<div className={cn('flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6', className)} {...props}>
			<div className='flex min-w-0 flex-col gap-0.5'>
				<span className='font-primary text-sm font-medium text-foreground'>{label}</span>
				{description && <span className='font-primary text-sm text-muted-foreground'>{description}</span>}
			</div>
			{children && <div className='shrink-0'>{children}</div>}
		</div>
	);
}

export const SettingsDialog = {
	Content: SettingsDialogContent,
	Group: SettingsDialogGroup,
	Item: SettingsDialogItem,
	Main: SettingsDialogMain,
	Nav: SettingsDialogNav,
	Panel: SettingsDialogPanel,
	Root: SettingsDialogRoot,
	Row: SettingsDialogRow,
	Search: SettingsDialogSearch,
	Section: SettingsDialogSection,
	Sidebar: SettingsDialogSidebar,
	Trigger: SettingsDialogTrigger,
};
