'use client';

import { type LucideIcon, PanelLeft, PanelRight, X } from 'lucide-react';
import * as React from 'react';
import { Icon } from '../../foundations/icon/icon';
import { useEscapeKey } from '../../overlays-feedback/modal/modal';
import { cn } from '../../utils/tailwind/cn';

/** Which viewport edge `SidebarFloat.Root` floats near. */
export type SidebarFloatSide = 'left' | 'right';

/** Texts rendered by `SidebarFloat`'s controls. Pass `lang` to `SidebarFloat.Root` to override any of them. */
export interface SidebarFloatLang {
	/** Accessible name of the button that expands a collapsed sidebar. */
	expandSidebar: string;
	/** Accessible name of the button that collapses the sidebar. */
	collapseSidebar: string;
	/** Accessible name of the mobile close button. */
	closeMenu: string;
	/** Accessible name of the navigation landmark. */
	primary: string;
}

/** English defaults for `SidebarFloatLang`. */
export const defaultSidebarFloatLang: SidebarFloatLang = {
	closeMenu: 'Close menu',
	collapseSidebar: 'Collapse sidebar',
	expandSidebar: 'Expand sidebar',
	primary: 'Primary',
};

interface SidebarFloatContextValue {
	readonly lang: SidebarFloatLang;
	readonly side: SidebarFloatSide;
	readonly collapsed: boolean;
	readonly setCollapsed: (collapsed: boolean) => void;
	readonly setMobileOpen: (open: boolean) => void;
}

const SidebarFloatContext = React.createContext<SidebarFloatContextValue | null>(null);

function useSidebarFloatContext() {
	const context = React.useContext(SidebarFloatContext);
	if (!context) {
		throw new Error('SidebarFloat subcomponents must be used within <SidebarFloat.Root>.');
	}
	return context;
}

export interface SidebarFloatRootProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'lang'> {
	/**
	 * Texts rendered by the controls. Merges over English defaults.
	 * @default defaultSidebarFloatLang
	 */
	lang?: Partial<SidebarFloatLang>;
	/**
	 * Which edge of the viewport the panel floats near.
	 * @default "left"
	 */
	side?: SidebarFloatSide;
	/** Desktop icon-rail collapse state, for controlled usage. */
	collapsed?: boolean;
	/** Initial collapsed state, for uncontrolled usage. @default true */
	defaultCollapsed?: boolean;
	/** Called whenever the collapsed state changes, controlled or not. */
	onCollapsedChange?: (collapsed: boolean) => void;
	/** Mobile off-canvas open state, for controlled usage. */
	mobileOpen?: boolean;
	/** Initial mobile-open state, for uncontrolled usage. @default false */
	defaultMobileOpen?: boolean;
	/** Called whenever the mobile-open state changes, controlled or not. */
	onMobileOpenChange?: (open: boolean) => void;
	children?: React.ReactNode;
}

/**
 * Compound floating sidebar — the same persistent nav as `Sidebar`, but as a
 * detached panel inset from the viewport edge instead of a flush full-height
 * column. On desktop it rests as a narrow icon rail and opens into a full
 * sidebar with labels (`SidebarFloat.CollapseTrigger`); below `md` (768px) it
 * becomes an off-canvas floating drawer that closes on `Escape`, on backdrop
 * click, and when an item is chosen — the same behaviour as `Sidebar`. All
 * state (`collapsed`, `mobileOpen`, which item is `active`) is a plain prop,
 * so it runs self-contained or driven by your own router/store.
 * @example
 * ```tsx
 * <SidebarFloat.Root>
 *   <SidebarFloat.Header>
 *     <SidebarFloat.Brand href="/" label="Acme"><Flame /></SidebarFloat.Brand>
 *     <SidebarFloat.CollapseTrigger />
 *     <SidebarFloat.MobileCloseTrigger />
 *   </SidebarFloat.Header>
 *   <SidebarFloat.Nav>
 *     <SidebarFloat.Item active href="/queue" icon={Feather} label="My post queue" />
 *     <SidebarFloat.Item badge={3} href="/inspiration" icon={Lightbulb} label="Inspiration" />
 *   </SidebarFloat.Nav>
 *   <SidebarFloat.Footer>
 *     <SidebarFloat.Item href="/settings" icon={Settings} label="Settings" />
 *   </SidebarFloat.Footer>
 * </SidebarFloat.Root>
 * ```
 */
function SidebarFloatRoot({
	lang,
	side = 'left',
	collapsed: controlledCollapsed,
	defaultCollapsed = true,
	onCollapsedChange,
	mobileOpen: controlledMobileOpen,
	defaultMobileOpen = false,
	onMobileOpenChange,
	className,
	children,
	...props
}: SidebarFloatRootProps) {
	const resolvedLang = React.useMemo(
		() => ({
			...defaultSidebarFloatLang,
			...lang,
		}),
		[lang]
	);
	const [uncontrolledCollapsed, setUncontrolledCollapsed] = React.useState(defaultCollapsed);
	const isCollapsedControlled = controlledCollapsed !== undefined;
	const collapsed = isCollapsedControlled ? controlledCollapsed : uncontrolledCollapsed;

	const [uncontrolledMobileOpen, setUncontrolledMobileOpen] = React.useState(defaultMobileOpen);
	const isMobileOpenControlled = controlledMobileOpen !== undefined;
	const mobileOpen = isMobileOpenControlled ? controlledMobileOpen : uncontrolledMobileOpen;

	const setCollapsed = React.useCallback(
		(value: boolean) => {
			if (!isCollapsedControlled) setUncontrolledCollapsed(value);
			onCollapsedChange?.(value);
		},
		[isCollapsedControlled, onCollapsedChange]
	);

	const setMobileOpen = React.useCallback(
		(value: boolean) => {
			if (!isMobileOpenControlled) setUncontrolledMobileOpen(value);
			onMobileOpenChange?.(value);
		},
		[isMobileOpenControlled, onMobileOpenChange]
	);

	useEscapeKey(mobileOpen, () => setMobileOpen(false));

	React.useEffect(() => {
		if (!mobileOpen) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [mobileOpen]);

	const value = React.useMemo<SidebarFloatContextValue>(
		() => ({
			collapsed,
			lang: resolvedLang,
			setCollapsed,
			setMobileOpen,
			side,
		}),
		[collapsed, resolvedLang, setCollapsed, setMobileOpen, side]
	);

	return (
		<SidebarFloatContext.Provider value={value}>
			{mobileOpen && (
				// biome-ignore lint/a11y/useSemanticElements: dimming backdrop, needs to be an absolutely-positioned div, not a <button>
				<div
					aria-hidden='true'
					className='fixed inset-0 z-30 bg-overlay transition-opacity duration-300 ease-in-out md:hidden motion-reduce:transition-none'
					onClick={() => setMobileOpen(false)}
					role='button'
					tabIndex={-1}
				/>
			)}
			<aside
				className={cn(
					'fixed inset-y-3 z-40 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-3 rounded-xl border border-border bg-background p-3 shadow-sm',
					'transition-[transform,width] duration-300 ease-in-out motion-reduce:transition-none',
					side === 'left' ? 'left-3' : 'right-3',
					mobileOpen ? 'translate-x-0' : side === 'left' ? '-translate-x-[calc(100%+1rem)]' : 'translate-x-[calc(100%+1rem)]',
					'md:max-w-none md:translate-x-0',
					collapsed ? 'md:w-16' : 'md:w-64',
					className
				)}
				{...props}
			>
				{children}
			</aside>
		</SidebarFloatContext.Provider>
	);
}

export interface SidebarFloatHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Top row — typically `SidebarFloat.Brand` plus `SidebarFloat.CollapseTrigger`/`SidebarFloat.MobileCloseTrigger`. Stacks the brand mark above the trigger once collapsed, since both can't share a row in the icon rail. */
function SidebarFloatHeader({ className, children, ...props }: SidebarFloatHeaderProps) {
	const { collapsed } = useSidebarFloatContext();

	return (
		<div className={cn('flex shrink-0 items-center justify-between gap-2', collapsed && 'md:flex-col md:justify-start md:gap-1', className)} {...props}>
			{children}
		</div>
	);
}

interface SidebarFloatBrandOwnProps {
	/** Wordmark shown beside the logo mark while expanded; hidden in the icon rail, where the mark (`children`) stands alone. */
	readonly label?: string;
	readonly className?: string;
	readonly children?: React.ReactNode;
	/**
	 * Element/component to render instead of `<a>` (e.g. a router `Link`).
	 * Must forward `className`, `ref` and remaining props to a single anchor.
	 * @default "a"
	 */
	readonly as?: React.ElementType;
}

export type SidebarFloatBrandProps<C extends React.ElementType = 'a'> = Omit<SidebarFloatBrandOwnProps, 'as'> & {
	readonly as?: C;
} & Omit<React.ComponentPropsWithoutRef<C>, keyof SidebarFloatBrandOwnProps>;

/** Logo slot in `SidebarFloat.Header`. Pass the mark as `children`; give it `label` for a visible wordmark, or an `aria-label` when the mark is all there is. */
function SidebarFloatBrand<C extends React.ElementType = 'a'>({ as, label, className, children, ...props }: SidebarFloatBrandProps<C>) {
	const { collapsed } = useSidebarFloatContext();
	const Component: React.ElementType = as ?? 'a';

	return (
		<Component
			className={cn(
				'flex h-8 min-w-0 items-center gap-2 rounded-md font-primary text-sm font-semibold text-foreground',
				'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
				collapsed && 'md:size-8 md:justify-center',
				className
			)}
			{...props}
		>
			<span className='flex size-8 shrink-0 items-center justify-center'>{children}</span>
			{label && <span className={cn('truncate', collapsed && 'md:hidden')}>{label}</span>}
		</Component>
	);
}

const sidebarFloatIconButtonClassName =
	'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-in-out hover:bg-muted hover:text-foreground focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!';

export interface SidebarFloatCollapseTriggerProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {}

/** Desktop-only button toggling `collapsed`. Hidden below `md`, where `SidebarFloat.MobileCloseTrigger` takes over. */
function SidebarFloatCollapseTrigger({ className, onClick, ...props }: SidebarFloatCollapseTriggerProps) {
	const { lang, side, collapsed, setCollapsed } = useSidebarFloatContext();

	return (
		<button
			aria-expanded={!collapsed}
			aria-label={collapsed ? lang.expandSidebar : lang.collapseSidebar}
			className={cn(sidebarFloatIconButtonClassName, 'hidden md:flex', className)}
			onClick={event => {
				onClick?.(event);
				setCollapsed(!collapsed);
			}}
			type='button'
			{...props}
		>
			<Icon aria-hidden='true' icon={side === 'left' ? PanelLeft : PanelRight} size='md' />
		</button>
	);
}

export interface SidebarFloatMobileCloseTriggerProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {}

/** Mobile-only button closing the off-canvas drawer. Hidden at `md` and up, where `SidebarFloat.CollapseTrigger` takes over. */
function SidebarFloatMobileCloseTrigger({ className, onClick, ...props }: SidebarFloatMobileCloseTriggerProps) {
	const { lang, setMobileOpen } = useSidebarFloatContext();

	return (
		<button
			aria-label={lang.closeMenu}
			className={cn(sidebarFloatIconButtonClassName, 'md:hidden', className)}
			onClick={event => {
				onClick?.(event);
				setMobileOpen(false);
			}}
			type='button'
			{...props}
		>
			<Icon aria-hidden='true' icon={X} size='md' />
		</button>
	);
}

export interface SidebarFloatNavProps extends React.HTMLAttributes<HTMLElement> {}

/** Scrollable nav landmark — holds `SidebarFloat.Item`/`SidebarFloat.Divider` in a `<ul>`. */
function SidebarFloatNav({ className, children, ...props }: SidebarFloatNavProps) {
	const { lang } = useSidebarFloatContext();

	return (
		<nav aria-label={lang.primary} className={cn('flex-1 overflow-x-hidden overflow-y-auto', className)} {...props}>
			<ul className='flex flex-col gap-1'>{children}</ul>
		</nav>
	);
}

/** Small counter badge over a `SidebarFloat.Item`'s icon, e.g. an unread count. */
function SidebarFloatItemBadge({ count }: { count?: number }) {
	if (!count || count <= 0) return null;

	return (
		<span
			aria-hidden='true'
			className='absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-secondary text-[0.625rem] leading-none font-semibold text-destructive-foreground ring-2 ring-background'
		>
			{count > 9 ? '9+' : count}
		</span>
	);
}

interface SidebarFloatItemOwnProps {
	/** Icon shown before the label — the only visible content in the collapsed rail. */
	readonly icon: LucideIcon;
	/** Item text. Shown as the label while expanded, and kept as the accessible name and native tooltip once collapsed. */
	readonly label: string;
	/** Marks this as the current page — subtle fill, full-ink label, and a left accent bar. */
	readonly active?: boolean;
	/** Small counter shown over the icon (e.g. unread count); also appended to the accessible name. Values over 9 show as "9+". */
	readonly badge?: number;
	readonly className?: string;
	readonly onClick?: React.MouseEventHandler<HTMLElement>;
	/**
	 * Element/component to render instead of `<a>` (e.g. a router `Link`).
	 * Must forward `className`, `ref` and remaining props to a single anchor.
	 * @default "a"
	 */
	readonly as?: React.ElementType;
}

export type SidebarFloatItemProps<C extends React.ElementType = 'a'> = Omit<SidebarFloatItemOwnProps, 'as'> & {
	readonly as?: C;
} & Omit<React.ComponentPropsWithoutRef<C>, keyof SidebarFloatItemOwnProps>;

/** One nav link. Renders a plain `<a>` by default; pass `as` (e.g. a router `Link`) for client-side routing. Closes `SidebarFloat.Root`'s mobile drawer on click. */
function SidebarFloatItem<C extends React.ElementType = 'a'>({ as, icon, label, active = false, badge, className, onClick, ...props }: SidebarFloatItemProps<C>) {
	const { collapsed, setMobileOpen } = useSidebarFloatContext();
	const Component: React.ElementType = as ?? 'a';
	const unreadLabel = badge && badge > 0 ? ` (${badge > 9 ? '9+' : badge} unread)` : '';

	return (
		<li className='relative'>
			<Component
				aria-current={active ? 'page' : undefined}
				className={cn(
					'group flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 font-primary text-sm transition-colors duration-150 ease-in-out',
					'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
					collapsed && 'md:justify-center md:px-0',
					active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
					className
				)}
				onClick={(event: React.MouseEvent<HTMLElement>) => {
					onClick?.(event);
					setMobileOpen(false);
				}}
				title={collapsed ? label : undefined}
				{...props}
			>
				<span className='relative shrink-0'>
					<Icon aria-hidden='true' icon={icon} size='md' />
					<SidebarFloatItemBadge count={badge} />
				</span>
				<span className={cn('min-w-0 flex-1 truncate', collapsed && 'md:sr-only')}>
					{label}
					{unreadLabel && <span className='sr-only'>{unreadLabel}</span>}
				</span>
			</Component>
		</li>
	);
}

export interface SidebarFloatDividerProps extends React.HTMLAttributes<HTMLLIElement> {}

/** Hairline separating item clusters inside `SidebarFloat.Nav`. */
function SidebarFloatDivider({ className, ...props }: SidebarFloatDividerProps) {
	return <li aria-hidden='true' className={cn('mx-2.5 my-1 h-px shrink-0 bg-border', className)} {...props} />;
}

export interface SidebarFloatFooterProps extends React.HTMLAttributes<HTMLUListElement> {}

/** Bottom-anchored cluster below `SidebarFloat.Nav` — typically a settings/account `SidebarFloat.Item`. */
function SidebarFloatFooter({ className, children, ...props }: SidebarFloatFooterProps) {
	return (
		<ul className={cn('flex shrink-0 flex-col gap-1 border-t border-border pt-3', className)} {...props}>
			{children}
		</ul>
	);
}

export const SidebarFloat = Object.assign(SidebarFloatRoot, {
	Brand: SidebarFloatBrand,
	CollapseTrigger: SidebarFloatCollapseTrigger,
	Divider: SidebarFloatDivider,
	Footer: SidebarFloatFooter,
	Header: SidebarFloatHeader,
	Item: SidebarFloatItem,
	MobileCloseTrigger: SidebarFloatMobileCloseTrigger,
	Nav: SidebarFloatNav,
	Root: SidebarFloatRoot,
});
