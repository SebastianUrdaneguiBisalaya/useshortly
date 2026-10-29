'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, Check, Columns3, Download, ListFilter, RefreshCw, Search as SearchIcon, X } from 'lucide-react';
import type * as React from 'react';
import { Button } from '../../actions-controls/button/button';
import { Input } from '../../forms-inputs/input/input';
import { Icon } from '../../foundations/icon/icon';
import { Dropdown } from '../../overlays-feedback/dropdown/dropdown';
import { cn } from '../../utils/tailwind/cn';
import { Badge } from '../badge/badge';

const filterTriggerClassName =
	'flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border bg-background px-3 font-primary text-sm font-medium text-foreground transition-colors duration-150 ease-in-out hover:bg-muted focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!';

export interface TableToolbarProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Root toolbar row for a table — put filters/search as the first child group
 * and actions (export, refresh, column visibility) as the second, and they
 * land on opposite ends, wrapping onto their own row on narrow viewports.
 * Every other piece here (`TableToolbar.Filter`, `.Search`, `.SortMenu`,
 * `.ExportButton`, `.RefreshButton`, `.ColumnVisibility`, `.FilterBar`,
 * `.FilterGroup`, `.BulkActionsBar`) is independent and optional — use
 * whichever ones a given table needs, in whatever combination, typically
 * passed as `DataTable`'s `toolbar` prop. None of them touch `DataTable`
 * internals or TanStack Table state directly: each is a small controlled
 * component (`value` + `onChange`) you wire to your own
 * filtering/sorting/export/selection logic, so this library stays free of
 * data-fetching/business-logic coupling. The one exception is row
 * *selection* itself (the checkbox column) — that lives on `DataTable` via
 * its `selection` prop, since it's tied to row rendering; see
 * `TableToolbar.BulkActionsBar` for the bar that goes with it.
 * @example
 * ```tsx
 * <DataTable
 *   columns={columns}
 *   data={data}
 *   toolbar={
 *     <TableToolbar>
 *       <div className="flex flex-wrap items-center gap-2">
 *         <TableToolbar.Search onValueChange={setQuery} value={query} />
 *         <TableToolbar.Filter
 *           label="Status"
 *           onChange={setStatus}
 *           options={[{ label: "Active", value: "active" }, { label: "Archived", value: "archived" }]}
 *           value={status}
 *         />
 *       </div>
 *       <div className="flex items-center gap-2">
 *         <TableToolbar.SortMenu columns={sortableColumns} onChange={setSort} value={sort} />
 *         <TableToolbar.ColumnVisibility columns={allColumns} onVisibleChange={setVisible} visible={visible} />
 *         <TableToolbar.ExportButton onExport={handleExport} />
 *         <TableToolbar.RefreshButton isRefreshing={isFetching} onRefresh={refetch} />
 *       </div>
 *     </TableToolbar>
 *   }
 * />
 * ```
 */
function TableToolbarRoot({ className, children, ...props }: TableToolbarProps) {
	return (
		<div className={cn('flex w-full flex-wrap items-center justify-between gap-3', className)} {...props}>
			{children}
		</div>
	);
}

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Shows a "Clear all" action at the end of the bar — pass this whenever at least one filter is active. */
	onClearAll?: () => void;
}

/** Row of active filters (typically `TableToolbar.Filter`/`.FilterGroup`), with an optional trailing "Clear all". Sits below `TableToolbar` when a table's filters need their own line. */
function FilterBar({ onClearAll, className, children, ...props }: FilterBarProps) {
	return (
		<div className={cn('flex w-full flex-wrap items-center gap-2', className)} {...props}>
			{children}
			{onClearAll && (
				<button
					className='font-primary text-xs font-medium text-muted-foreground underline-offset-4 transition-colors duration-150 ease-in-out hover:text-foreground hover:underline'
					onClick={onClearAll}
					type='button'
				>
					Clear all
				</button>
			)}
		</div>
	);
}

export interface FilterGroupProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Accessible name for the group, e.g. `"Date range"` when it holds two related `TableToolbar.Filter`s. */
	label: string;
}

/** Tight cluster of related `TableToolbar.Filter`s (e.g. two ends of a range) inside a `TableToolbar.FilterBar`, grouped for assistive tech via `role="group"`. */
function FilterGroup({ label, className, children, ...props }: FilterGroupProps) {
	return (
		<div aria-label={label} className={cn('flex items-center gap-1.5', className)} role='group' {...props}>
			{children}
		</div>
	);
}

/** Shared checkbox-style row used by `TableToolbar.Filter` and `TableToolbar.ColumnVisibility`'s dropdowns — a `role="menuitemcheckbox"` row that toggles without closing the menu (unlike `Dropdown.Item`, which closes on select). */
function ToggleRow({ checked, label, onToggle }: { checked: boolean; label: React.ReactNode; onToggle: () => void }) {
	return (
		<div
			aria-checked={checked}
			className='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 font-primary text-sm text-foreground outline-none transition-colors duration-100 ease-in-out hover:bg-muted focus:bg-muted'
			onClick={onToggle}
			onKeyDown={event => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					onToggle();
				}
			}}
			role='menuitemcheckbox'
			tabIndex={0}
		>
			<span
				className={cn(
					'flex size-4 shrink-0 items-center justify-center rounded-sm border border-border transition-colors duration-150 ease-in-out',
					checked && 'border-transparent bg-foreground text-background'
				)}
			>
				{checked && <Icon aria-hidden='true' icon={Check} size='xs' />}
			</span>
			<span className='truncate'>{label}</span>
		</div>
	);
}

export interface BulkActionsBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
	/** Number of currently selected rows — the bar renders nothing at `0`. */
	count: number;
	/** Clears the selection (e.g. a "Clear" text button next to the count). */
	onClear: () => void;
	/** Bulk actions (typically `Button`s — a destructive "Delete", "Export selected", ...). */
	children?: React.ReactNode;
}

/**
 * "N selected" bar — swap this in for `TableToolbar` (via `DataTable`'s
 * `toolbar` prop) once `DataTable`'s `selection.selectedIds` isn't empty, so
 * bulk actions only ever show up when there's something to act on. The
 * selection state itself lives in `DataTable` (it owns the checkbox column
 * and the header "select all"); this bar is purely the chrome that shows
 * the count and hosts your own action buttons.
 * @example
 * ```tsx
 * <DataTable
 *   columns={columns}
 *   data={data}
 *   selection={{ getRowId: (row) => row.id, onSelectedIdsChange: setSelectedIds, selectedIds }}
 *   toolbar={
 *     selectedIds.size > 0 ? (
 *       <TableToolbar.BulkActionsBar count={selectedIds.size} onClear={() => setSelectedIds(new Set())}>
 *         <Button variant="secondary"><Button.Text>Export</Button.Text></Button>
 *         <Button variant="destructive"><Button.Text>Delete</Button.Text></Button>
 *       </TableToolbar.BulkActionsBar>
 *     ) : (
 *       <TableToolbar>...</TableToolbar>
 *     )
 *   }
 * />
 * ```
 */
function BulkActionsBar({ count, onClear, className, children, ...props }: BulkActionsBarProps) {
	if (count <= 0) return null;

	return (
		<div className={cn('flex w-full flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted px-3 py-2', className)} {...props}>
			<div className='flex items-center gap-3'>
				<span className='font-primary text-sm font-medium text-foreground'>{count} selected</span>
				<button
					className='font-primary text-xs font-medium text-muted-foreground underline-offset-4 transition-colors duration-150 ease-in-out hover:text-foreground hover:underline'
					onClick={onClear}
					type='button'
				>
					Clear
				</button>
			</div>
			{children && <div className='flex flex-wrap items-center gap-2'>{children}</div>}
		</div>
	);
}

export interface FilterOption<T extends string = string> {
	readonly value: T;
	readonly label: React.ReactNode;
}

export interface FilterProps<T extends string = string> {
	/** Field name shown on the trigger, e.g. `"Status"`. */
	label: string;
	/** Selectable values for this filter. */
	options: readonly FilterOption<T>[];
	/** Currently selected values, for controlled usage. */
	value: readonly T[];
	/** Called with the full new selection whenever it changes. */
	onChange: (value: T[]) => void;
	className?: string;
}

/**
 * One faceted, multi-select filter — a dashed trigger button (showing a
 * count badge once any value is selected) opening a checklist that stays
 * open across multiple picks, following the common "faceted filter" pattern
 * for data tables.
 * @example
 * ```tsx
 * <TableToolbar.Filter
 *   label="Status"
 *   onChange={setStatus}
 *   options={[{ label: "Active", value: "active" }, { label: "Archived", value: "archived" }]}
 *   value={status}
 * />
 * ```
 */
function Filter<T extends string = string>({ label, options, value, onChange, className }: FilterProps<T>) {
	const toggle = (optionValue: T) => {
		onChange(value.includes(optionValue) ? value.filter(v => v !== optionValue) : [...value, optionValue]);
	};

	return (
		<Dropdown>
			<Dropdown.Trigger>
				<button className={cn(filterTriggerClassName, className)} type='button'>
					<Icon aria-hidden='true' className='text-muted-foreground' icon={ListFilter} size='sm' />
					{label}
					{value.length > 0 && (
						<Badge className='px-1.5'>
							<Badge.Text>{value.length}</Badge.Text>
						</Badge>
					)}
				</button>
			</Dropdown.Trigger>
			<Dropdown.Content className='max-h-64 overflow-y-auto'>
				<Dropdown.Label>{label}</Dropdown.Label>
				{options.map(option => (
					<ToggleRow checked={value.includes(option.value)} key={option.value} label={option.label} onToggle={() => toggle(option.value)} />
				))}
			</Dropdown.Content>
		</Dropdown>
	);
}

export type SortDirection = 'asc' | 'desc';

export interface SortColumn {
	readonly id: string;
	readonly label: string;
}

export interface SortCriterion {
	readonly columnId: string;
	readonly direction: SortDirection;
}

/** Texts rendered by `TableToolbar.SortMenu`. Pass `lang` to override any of them. */
export interface SortMenuLang {
	/** Trigger label while unsorted. */
	sort: string;
	/** Trigger label while sorted by more than one column, given the count. */
	sortCount: (count: number) => string;
	/** Heading of the dropdown. */
	sortBy: string;
	/** Label of the "clear sort" item. */
	clearSort: string;
}

/** English defaults for `SortMenuLang`. */
export const defaultSortMenuLang: SortMenuLang = {
	clearSort: 'Clear sort',
	sort: 'Sort',
	sortBy: 'Sort by',
	sortCount: count => `Sort (${count})`,
};

export interface SortMenuProps {
	/** Columns the table can be sorted by. */
	columns: readonly SortColumn[];
	/**
	 * Active sort, in priority order — the first entry is the primary sort,
	 * the second breaks ties within it, and so on. Empty for unsorted, for
	 * controlled usage.
	 */
	value: readonly SortCriterion[];
	/** Called with the full new priority-ordered sort whenever it changes. */
	onChange: (value: SortCriterion[]) => void;
	/**
	 * Texts rendered by this component. Merges over English defaults.
	 * @default defaultSortMenuLang
	 */
	lang?: Partial<SortMenuLang>;
	className?: string;
}

/** One row of `TableToolbar.SortMenu` — click cycles a column through unsorted → ascending → descending → unsorted, staying open across clicks so a multi-column priority order can be built in one pass (unlike `Dropdown.Item`, which closes on select). */
function SortRow({ column, criterion, priority, onCycle }: { column: SortColumn; criterion: SortCriterion | undefined; priority: number; onCycle: () => void }) {
	return (
		<div
			aria-checked={!!criterion}
			className='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 font-primary text-sm text-foreground outline-none transition-colors duration-100 ease-in-out hover:bg-muted focus:bg-muted'
			onClick={onCycle}
			onKeyDown={event => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					onCycle();
				}
			}}
			role='menuitemcheckbox'
			tabIndex={0}
		>
			<span
				className={cn(
					'flex size-4 shrink-0 items-center justify-center rounded-full font-secondary text-[0.625rem] font-medium',
					criterion ? 'bg-foreground text-background' : 'text-transparent'
				)}
			>
				{criterion ? priority : '0'}
			</span>
			<span className='flex-1 truncate'>{column.label}</span>
			{criterion && <Icon aria-hidden='true' icon={criterion.direction === 'asc' ? ArrowUp : ArrowDown} size='xs' />}
		</div>
	);
}

/**
 * Sort-by dropdown (aka "SortColumns") — a checklist, not a single-pick
 * menu: clicking a column adds it as the next-lowest priority, clicking an
 * already-active one flips its direction then (on a third click) drops it,
 * so a multi-column sort ("status, then name") builds up one click at a
 * time without the menu closing between picks. Each active row shows its
 * priority number.
 * @example
 * ```tsx
 * <TableToolbar.SortMenu
 *   columns={[{ id: "status", label: "Status" }, { id: "name", label: "Name" }]}
 *   onChange={setSort}
 *   value={sort}
 * />
 * ```
 */
function SortMenu({ columns, value, onChange, lang, className }: SortMenuProps) {
	const resolvedLang = { ...defaultSortMenuLang, ...lang };
	const cycle = (columnId: string) => {
		const index = value.findIndex(criterion => criterion.columnId === columnId);
		if (index === -1) {
			onChange([
				...value,
				{
					columnId,
					direction: 'asc',
				},
			]);
			return;
		}

		const criterion = value[index];
		if (criterion.direction === 'asc') {
			onChange(
				value.map((entry, i) =>
					i === index
						? {
								columnId,
								direction: 'desc',
							}
						: entry
				)
			);
			return;
		}

		onChange(value.filter(entry => entry.columnId !== columnId));
	};

	const triggerLabel =
		value.length === 0 ? resolvedLang.sort : value.length === 1 ? (columns.find(column => column.id === value[0].columnId)?.label ?? resolvedLang.sort) : resolvedLang.sortCount(value.length);

	return (
		<Dropdown>
			<Dropdown.Trigger>
				<Button className={className} variant='secondary'>
					<Button.Icon icon={ArrowUpDown} />
					<Button.Text>{triggerLabel}</Button.Text>
				</Button>
			</Dropdown.Trigger>
			<Dropdown.Content align='end'>
				<Dropdown.Label>{resolvedLang.sortBy}</Dropdown.Label>
				{columns.map(column => {
					const criterion = value.find(entry => entry.columnId === column.id);
					const priority = criterion ? value.indexOf(criterion) + 1 : 0;
					return <SortRow column={column} criterion={criterion} key={column.id} onCycle={() => cycle(column.id)} priority={priority} />;
				})}
				{value.length > 0 && (
					<>
						<Dropdown.Separator />
						<Dropdown.Item onSelect={() => onChange([])}>{resolvedLang.clearSort}</Dropdown.Item>
					</>
				)}
			</Dropdown.Content>
		</Dropdown>
	);
}

export interface TableSearchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'className'> {
	/** Current search text, for controlled usage. */
	value: string;
	/** Called with the new text on every keystroke — debounce in the caller if querying a server. */
	onValueChange: (value: string) => void;
	/**
	 * @default "Search…"
	 */
	placeholder?: string;
	/**
	 * Accessible label of the clear button, shown once there's text.
	 * @default "Clear search"
	 */
	clearLabel?: string;
	className?: string;
}

/** Search box for a table — a search icon, and a clear button that appears once there's text. Plain `value`/`onValueChange`; debounce it yourself if it drives a server request. */
function TableSearch({ value, onValueChange, placeholder = 'Search…', clearLabel = 'Clear search', className, ...props }: TableSearchProps) {
	return (
		<Input className={cn('h-8 w-full py-1 sm:w-64', className)}>
			<Input.Icon icon={SearchIcon} />
			<Input.Field onChange={event => onValueChange(event.target.value)} placeholder={placeholder} value={value} {...props} />
			{value.length > 0 && (
				<button
					aria-label={clearLabel}
					className='flex shrink-0 items-center justify-center text-muted-foreground transition-colors duration-150 ease-in-out hover:text-foreground'
					onClick={() => onValueChange('')}
					type='button'
				>
					<Icon aria-hidden='true' icon={X} size='sm' />
				</button>
			)}
		</Input>
	);
}

export type TableExportFormat = 'csv' | 'xlsx';

/** Texts rendered by `TableToolbar.ExportButton`. Pass `lang` to override any of them. */
export interface TableExportButtonLang {
	/** Trigger button label. */
	export: string;
	/** Label of the CSV menu item. */
	exportAsCsv: string;
	/** Label of the XLSX menu item. */
	exportAsXlsx: string;
}

/** English defaults for `TableExportButtonLang`. */
export const defaultTableExportButtonLang: TableExportButtonLang = {
	export: 'Export',
	exportAsCsv: 'Export as CSV',
	exportAsXlsx: 'Export as XLSX',
};

export interface TableExportButtonProps {
	/** Called with the chosen format — generating and downloading the file is left to the caller, so this library stays free of an export dependency. */
	onExport: (format: TableExportFormat) => void;
	/** Disables both options, e.g. while an export is already in progress. */
	disabled?: boolean;
	/**
	 * Texts rendered by this component. Merges over English defaults.
	 * @default defaultTableExportButtonLang
	 */
	lang?: Partial<TableExportButtonLang>;
	className?: string;
}

/** Export button with a format menu (CSV / XLSX). */
function TableExportButton({ onExport, disabled = false, lang, className }: TableExportButtonProps) {
	const resolvedLang = { ...defaultTableExportButtonLang, ...lang };

	return (
		<Dropdown>
			<Dropdown.Trigger>
				<Button className={className} disabled={disabled} variant='secondary'>
					<Button.Icon icon={Download} />
					<Button.Text>{resolvedLang.export}</Button.Text>
				</Button>
			</Dropdown.Trigger>
			<Dropdown.Content align='end'>
				<Dropdown.Item onSelect={() => onExport('csv')}>{resolvedLang.exportAsCsv}</Dropdown.Item>
				<Dropdown.Item onSelect={() => onExport('xlsx')}>{resolvedLang.exportAsXlsx}</Dropdown.Item>
			</Dropdown.Content>
		</Dropdown>
	);
}

export interface TableRefreshButtonProps {
	/** Called on click. */
	onRefresh: () => void;
	/**
	 * Spins the icon and disables the button while a refresh is in flight.
	 * @default false
	 */
	isRefreshing?: boolean;
	/**
	 * Accessible name/tooltip of the button.
	 * @default "Refresh"
	 */
	label?: string;
	className?: string;
}

/** Icon-only refresh button — spins while `isRefreshing`. */
function TableRefreshButton({ onRefresh, isRefreshing = false, label = 'Refresh', className }: TableRefreshButtonProps) {
	return (
		<Button aria-label={label} className={className} disabled={isRefreshing} onClick={onRefresh} size='icon' variant='secondary'>
			<Button.Icon className={cn(isRefreshing && 'animate-spin')} icon={RefreshCw} />
		</Button>
	);
}

export interface ColumnVisibilityOption {
	readonly id: string;
	readonly label: string;
}

/** Texts rendered by `TableToolbar.ColumnVisibility`. Pass `lang` to override any of them. */
export interface ColumnVisibilityLang {
	/** Trigger button label. */
	columns: string;
	/** Heading of the dropdown. */
	toggleColumns: string;
}

/** English defaults for `ColumnVisibilityLang`. */
export const defaultColumnVisibilityLang: ColumnVisibilityLang = {
	columns: 'Columns',
	toggleColumns: 'Toggle columns',
};

export interface ColumnVisibilityProps {
	/** Every toggleable column. */
	columns: readonly ColumnVisibilityOption[];
	/** IDs of the currently visible columns, for controlled usage. */
	visible: readonly string[];
	/** Called with the full new set of visible column IDs whenever it changes. */
	onVisibleChange: (visible: string[]) => void;
	/**
	 * Texts rendered by this component. Merges over English defaults.
	 * @default defaultColumnVisibilityLang
	 */
	lang?: Partial<ColumnVisibilityLang>;
	className?: string;
}

/** "Show/hide columns" dropdown — a checklist that stays open across multiple toggles, same interaction as `TableToolbar.Filter`. */
function ColumnVisibility({ columns, visible, onVisibleChange, lang, className }: ColumnVisibilityProps) {
	const resolvedLang = { ...defaultColumnVisibilityLang, ...lang };
	const toggle = (id: string) => {
		onVisibleChange(visible.includes(id) ? visible.filter(v => v !== id) : [...visible, id]);
	};

	return (
		<Dropdown>
			<Dropdown.Trigger>
				<Button className={className} variant='secondary'>
					<Button.Icon icon={Columns3} />
					<Button.Text>{resolvedLang.columns}</Button.Text>
				</Button>
			</Dropdown.Trigger>
			<Dropdown.Content align='end' className='max-h-64 overflow-y-auto'>
				<Dropdown.Label>{resolvedLang.toggleColumns}</Dropdown.Label>
				{columns.map(column => (
					<ToggleRow checked={visible.includes(column.id)} key={column.id} label={column.label} onToggle={() => toggle(column.id)} />
				))}
			</Dropdown.Content>
		</Dropdown>
	);
}

export const TableToolbar = Object.assign(TableToolbarRoot, {
	BulkActionsBar,
	ColumnVisibility,
	ExportButton: TableExportButton,
	Filter,
	FilterBar,
	FilterGroup,
	RefreshButton: TableRefreshButton,
	Search: TableSearch,
	SortMenu,
});
