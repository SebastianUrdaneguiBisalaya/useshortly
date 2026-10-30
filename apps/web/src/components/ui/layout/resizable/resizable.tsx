'use client';

import { ChevronsDown, ChevronsLeft, ChevronsRight, ChevronsUp } from 'lucide-react';
import * as React from 'react';
import { Group, type GroupProps, type LayoutStorage, Panel, type PanelImperativeHandle, type PanelProps, Separator, type SeparatorProps, useDefaultLayout } from 'react-resizable-panels';

import { cn } from '../../utils/tailwind/cn';

export {
	type GroupImperativeHandle,
	type PanelImperativeHandle,
	useGroupRef,
	usePanelRef,
} from 'react-resizable-panels';

/**
 * `localStorage` that never throws: it is unavailable during SSR (Next.js renders client components on the
 * server too) and can be blocked or full in the browser (private windows, cleared site data).
 */
const safeStorage: LayoutStorage = {
	getItem(key) {
		try {
			return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
		} catch {
			return null;
		}
	},
	setItem(key, value) {
		try {
			if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
		} catch {
			// Persistence is a convenience; losing it must never break the layout.
		}
	},
};

/** Tailwind-equivalent breakpoints, in pixels, that `Resizable`'s `stackBelow` can switch at. */
const breakpoints = {
	lg: 1024,
	md: 768,
	sm: 640,
} as const;

/** Viewport width below which a `Resizable` group stacks its panels instead of splitting them side by side. */
export type ResizableBreakpoint = keyof typeof breakpoints;

/** Whether the viewport is narrower than `breakpoint`. `false` on the server and on first render, to keep hydration stable. */
function useBelowBreakpoint(breakpoint: ResizableBreakpoint | undefined) {
	const [below, setBelow] = React.useState(false);

	React.useEffect(() => {
		if (!breakpoint) {
			setBelow(false);
			return;
		}
		const query = window.matchMedia(`(max-width: ${breakpoints[breakpoint] - 0.02}px)`);
		const update = () => setBelow(query.matches);
		update();
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	}, [breakpoint]);

	return below;
}

/** What a `Resizable.Handle` needs from its group: the axis it sits on, and when panel sizes changed. */
interface ResizableContextValue {
	/** Axis the group is currently laid out along, after `stackBelow` has been applied. */
	orientation: 'horizontal' | 'vertical';
	/** Registers a listener called whenever the group's layout changes. Returns its unsubscribe function. */
	subscribe: (listener: () => void) => () => void;
}

const ResizableContext = React.createContext<ResizableContextValue | null>(null);

export interface ResizableProps extends Omit<GroupProps, 'orientation'> {
	/**
	 * Axis the panels are laid out along. `"horizontal"` puts them side by side (a vertical drag handle);
	 * `"vertical"` stacks them (a horizontal drag handle).
	 * @default "horizontal"
	 */
	direction?: 'horizontal' | 'vertical';
	/**
	 * Persists the layout in `localStorage` under this key, so sizes survive reloads. Every `Resizable.Panel`
	 * in the group must then have a stable `id`. Storage failures (SSR, blocked storage) are ignored.
	 */
	autoSaveId?: string;
	/**
	 * Below this viewport width the group switches to `"vertical"`, so a side-by-side split doesn't squeeze
	 * both panels on a phone. The parent needs a definite height in that case.
	 */
	stackBelow?: ResizableBreakpoint;
}

/**
 * Root of a resizable split layout (VS Code / IDE style): a set of `Resizable.Panel`s separated by draggable
 * `Resizable.Handle`s. Built on `react-resizable-panels`, so it also provides pointer capture, keyboard
 * resizing (WAI-ARIA Window Splitter), collapse and layout persistence.
 *
 * It fills its parent (`h-full w-full`), and the library applies that inline, so the height must come from the
 * parent element (a `className` height on the group itself would be overridden). Panels use the library's size units:
 * a bare number is **pixels**, a string is a percentage (`"40"`, `"40%"`) or carries a unit (`"20rem"`).
 *
 * @example
 * ```tsx
 * <Resizable autoSaveId="editor-chat" className="h-screen">
 *   <Resizable.Panel id="code" defaultSize="60%" minSize="30%">…code…</Resizable.Panel>
 *   <Resizable.Handle />
 *   <Resizable.Panel id="chat" defaultSize="40%" minSize="25%" collapsible>…chat…</Resizable.Panel>
 * </Resizable>
 * ```
 */
function ResizableRoot({ autoSaveId, className, defaultLayout, direction = 'horizontal', onLayoutChanged, stackBelow, ...props }: ResizableProps) {
	const persisted = useDefaultLayout({
		id: autoSaveId ?? 'resizable',
		storage: safeStorage,
	});
	const below = useBelowBreakpoint(stackBelow);
	const orientation = below ? 'vertical' : direction;

	// Handles read their neighbour's collapsed state imperatively, so they need to know when sizes moved.
	const listeners = React.useRef(new Set<() => void>());
	const context = React.useMemo<ResizableContextValue>(
		() => ({
			orientation,
			subscribe: listener => {
				listeners.current.add(listener);
				return () => {
					listeners.current.delete(listener);
				};
			},
		}),
		[orientation]
	);

	return (
		<ResizableContext.Provider value={context}>
			<Group
				{...props}
				className={cn('h-full w-full', className)}
				defaultLayout={defaultLayout ?? (autoSaveId ? persisted.defaultLayout : undefined)}
				key={orientation}
				onLayoutChanged={(layout, meta) => {
					if (autoSaveId) persisted.onLayoutChanged(layout, meta);
					onLayoutChanged?.(layout, meta);
					for (const listener of listeners.current) listener();
				}}
				orientation={orientation}
			/>
		</ResizableContext.Provider>
	);
}

export interface ResizablePanelProps extends PanelProps {
	/**
	 * Stable identifier of the panel. Required for `autoSaveId` persistence, since the saved layout is keyed by it.
	 */
	id?: string;
	/**
	 * Initial size. A bare number is pixels; a string is a percentage (`"40"`, `"40%"`) or has a unit (`"20rem"`).
	 */
	defaultSize?: number | string;
	/**
	 * Smallest size the panel can be dragged to (same units as `defaultSize`). Defaults to 0%.
	 */
	minSize?: number | string;
	/**
	 * Largest size the panel can be dragged to (same units as `defaultSize`).
	 * @default "100%"
	 */
	maxSize?: number | string;
	/**
	 * Lets the panel snap closed when it is dragged below `minSize`. Use `usePanelRef` to collapse or expand
	 * it from a button.
	 * @default false
	 */
	collapsible?: boolean;
	/**
	 * Size the panel keeps while collapsed.
	 * @default "0%"
	 */
	collapsedSize?: number | string;
}

/**
 * One pane of the split. Its content is entirely yours; it scrolls on overflow by default. Panels and handles
 * must be direct children of `Resizable`.
 */
function ResizablePanel({ className, ...props }: ResizablePanelProps) {
	return <Panel {...props} className={cn('overflow-auto', className)} />;
}

/** Where the inline collapse button sits along the handle. */
export type ResizableCollapseButtonPosition = 'start' | 'center' | 'end';

export interface ResizableHandleProps extends SeparatorProps {
	/**
	 * Prevents this handle from resizing its neighbouring panels.
	 * @default false
	 */
	disabled?: boolean;
	/**
	 * Stops a double click on the handle from resetting its panels to their default size.
	 * @default false
	 */
	disableDoubleClick?: boolean;
	/**
	 * Renders a chevron button on the handle itself that collapses and expands one of its neighbouring panels,
	 * instead of needing a button somewhere else in the page. Requires `collapsePanelRef` to point at a
	 * `collapsible` panel; using `usePanelRef` on your own from outside keeps working either way.
	 * @default false
	 */
	withCollapseButton?: boolean;
	/**
	 * Ref of the `collapsible` panel the inline button collapses and expands, created with `usePanelRef`.
	 * Pass the same ref to that panel's `panelRef`.
	 */
	collapsePanelRef?: React.RefObject<PanelImperativeHandle | null>;
	/**
	 * Which side of the handle `collapsePanelRef` is on, so the chevron points the way the panel will move.
	 * @default "end"
	 */
	collapseTarget?: 'start' | 'end';
	/**
	 * Where the inline button sits along the handle: at its beginning, its middle, or its end.
	 * @default "start"
	 */
	collapseButtonPosition?: ResizableCollapseButtonPosition;
	/**
	 * Accessible label of the inline button while the panel is open.
	 * @default "Collapse panel"
	 */
	collapseLabel?: string;
	/**
	 * Accessible label of the inline button while the panel is collapsed.
	 * @default "Expand panel"
	 */
	expandLabel?: string;
}

/** Keeps the inline button in sync with its panel, which is collapsed imperatively and reports no React state. */
function useIsCollapsed(panelRef: React.RefObject<PanelImperativeHandle | null> | undefined, enabled: boolean) {
	const context = React.useContext(ResizableContext);
	const [collapsed, setCollapsed] = React.useState(false);

	React.useEffect(() => {
		if (!enabled || !panelRef || !context) return;
		const read = () => setCollapsed(panelRef.current?.isCollapsed() ?? false);
		read();
		return context.subscribe(read);
	}, [context, enabled, panelRef]);

	return [collapsed, setCollapsed] as const;
}

/**
 * Draggable divider between two panels. It is a focusable `role="separator"`: arrow keys resize, Home/End
 * jump to the limits and Enter collapses a `collapsible` neighbour (WAI-ARIA Window Splitter). Drawn as a
 * one-pixel rule that darkens on hover and while dragging; the pointer hit area is larger than the line.
 *
 * With `withCollapseButton`, it also renders a chevron button sitting on the line that collapses and expands
 * the panel given by `collapsePanelRef`.
 *
 * @example
 * ```tsx
 * const chat = usePanelRef();
 * <Resizable>
 *   <Resizable.Panel id="code" defaultSize="65%" minSize="30%">…</Resizable.Panel>
 *   <Resizable.Handle collapsePanelRef={chat} withCollapseButton />
 *   <Resizable.Panel id="chat" collapsible defaultSize="35%" minSize="20%" panelRef={chat}>…</Resizable.Panel>
 * </Resizable>
 * ```
 */
function ResizableHandle({
	children,
	className,
	collapseButtonPosition = 'start',
	collapseLabel = 'Collapse panel',
	collapsePanelRef,
	collapseTarget = 'end',
	expandLabel = 'Expand panel',
	withCollapseButton = false,
	...props
}: ResizableHandleProps) {
	const context = React.useContext(ResizableContext);
	const showButton = withCollapseButton && Boolean(collapsePanelRef);
	const [collapsed, setCollapsed] = useIsCollapsed(collapsePanelRef, showButton);

	// Side by side, the button closes the panel sideways; stacked, it closes it up or down.
	const sideBySide = context?.orientation !== 'vertical';
	const towardsEnd = collapseTarget === 'end' ? !collapsed : collapsed;
	const Icon = sideBySide ? (towardsEnd ? ChevronsRight : ChevronsLeft) : towardsEnd ? ChevronsDown : ChevronsUp;

	const toggle = () => {
		const panel = collapsePanelRef?.current;
		if (!panel) return;
		if (panel.isCollapsed()) panel.expand();
		else panel.collapse();
		setCollapsed(panel.isCollapsed());
	};

	return (
		<Separator
			{...props}
			className={cn(
				'relative shrink-0 bg-border transition-colors duration-150 ease-in-out outline-none',
				// The line's thickness is fixed; its length comes from the flex container stretching it.
				'aria-[orientation=vertical]:w-px aria-[orientation=horizontal]:h-px',
				'data-[separator=hover]:bg-foreground-tertiary data-[separator=active]:bg-foreground-secondary data-[separator=focus]:bg-foreground-secondary',
				'focus-visible:outline-2 focus-visible:outline-ring',
				className
			)}
		>
			{children}
			{showButton ? (
				<button
					aria-label={collapsed ? expandLabel : collapseLabel}
					className={cn(
						'absolute z-10 flex size-6 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-foreground-secondary transition-colors duration-150 ease-in-out',
						'hover:bg-hover hover:text-foreground',
						'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
						sideBySide ? 'left-1/2 -translate-x-1/2' : 'top-1/2 -translate-y-1/2',
						sideBySide && collapseButtonPosition === 'start' && 'top-3',
						sideBySide && collapseButtonPosition === 'center' && 'top-1/2 -translate-y-1/2',
						sideBySide && collapseButtonPosition === 'end' && 'bottom-3',
						!sideBySide && collapseButtonPosition === 'start' && 'left-3',
						!sideBySide && collapseButtonPosition === 'center' && 'left-1/2 -translate-x-1/2',
						!sideBySide && collapseButtonPosition === 'end' && 'right-3'
					)}
					onClick={toggle}
					// The separator starts a drag on pointer down; the button must not.
					onDoubleClick={event => event.stopPropagation()}
					onKeyDown={event => event.stopPropagation()}
					onPointerDown={event => event.stopPropagation()}
					type='button'
				>
					<Icon aria-hidden='true' className='size-3.5' />
				</button>
			) : null}
		</Separator>
	);
}

export const Resizable = Object.assign(ResizableRoot, {
	Handle: ResizableHandle,
	Panel: ResizablePanel,
});
