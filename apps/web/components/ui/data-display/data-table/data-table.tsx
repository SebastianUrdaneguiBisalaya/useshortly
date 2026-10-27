"use client";

import {
  type ColumnDef,
  columnSizingFeature,
  flexRender,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { Checkbox } from "../../forms-inputs/checkbox/checkbox";
import { cn } from "../../utils/tailwind/cn";
import { Pagination } from "../pagination/pagination";

const dataTableFeatures = tableFeatures({
  columnSizingFeature,
});

/** Feature set passed to `useTable`; consumers need this to type their `columns` array as `ColumnDef<DataTableFeatures, TData>[]`. */
export type DataTableFeatures = typeof dataTableFeatures;

export interface TablePagination {
  /** Current 1-indexed page. */
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  /** Total row count across all pages. */
  readonly total: number;
  readonly onPageChange: (page: number) => void;
}

export interface TableSelection<TData> {
  /** IDs of the currently selected rows, for controlled usage — own this state yourself (e.g. next to a `TableToolbar.BulkActionsBar`) and pass it back in. */
  readonly selectedIds: ReadonlySet<string>;
  /** Called with the full new set of selected IDs on any change — a single row, or "select/clear all" from the header checkbox. */
  readonly onSelectedIdsChange: (ids: Set<string>) => void;
  /** Derives a stable string ID from a row's data (e.g. `(row) => row.id`) — required since selection must survive re-sorting/re-fetching, which a table-internal row index can't. */
  readonly getRowId: (row: TData) => string;
}

export interface DataTableProps<TData extends Record<string, any>> {
  readonly data: TData[];
  readonly columns: ColumnDef<DataTableFeatures, TData>[];
  /** Omit to render without a pagination bar (e.g. a short, unpaginated list). */
  readonly pagination?: TablePagination;
  /** Renders skeleton rows in place of `data`. */
  readonly isLoading?: boolean;
  /** Arbitrary content (filters, search, actions) above the pagination bar. */
  readonly toolbar?: React.ReactNode;
  /**
   * Text shown when `data` is empty. Ignored if `emptyState` is passed.
   * @default "No data available."
   */
  readonly emptyMessage?: string;
  /** Custom content shown when `data` is empty, instead of `emptyMessage`. */
  readonly emptyState?: React.ReactNode;
  /** Makes rows clickable, calling back with the row's original data. */
  readonly onRowClick?: (row: TData) => void;
  /** Adds a checkbox column (with a "select all [on this page]" header checkbox) for bulk actions. Omit for a table with no bulk actions. */
  readonly selection?: TableSelection<TData>;
  /** Extra classes on the root wrapper. The root and the row-scroll region both carry `flex-1 min-h-0`, so putting this table inside a flex column with a bounded height (e.g. `Page.Body` given `flex-1 min-h-0`) makes it grow to fill the available space and scroll its own rows — under the header — instead of the whole page scrolling. Inert in a normal auto-sized parent, so this is safe to leave on by default. */
  readonly className?: string;
}

/** Placeholder rows shown while `isLoading` is true. `hasSelection` adds one extra empty cell so columns still line up with the checkbox column. */
function SkeletonRows({
  colCount,
  hasSelection,
}: {
  colCount: number;
  hasSelection: boolean;
}) {
  return Array.from(
    {
      length: 6,
    },
    (_, rowIdx) => (
      <tr
        className="border-b border-border"
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder sin id estable
        key={rowIdx}
      >
        {hasSelection && <td className="px-4 py-3.5" />}
        {Array.from(
          {
            length: colCount,
          },
          (_, colIdx) => (
            <td
              className="px-4 py-3.5"
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder sin id estable
              key={colIdx}
            >
              <div
                className="h-4 bg-muted rounded-md animate-pulse"
                style={{
                  width: `${60 + (colIdx % 3) * 15}%`,
                }}
              />
            </td>
          ),
        )}
      </tr>
    ),
  );
}

/**
 * Data table with column sizing (TanStack Table's standalone-features API),
 * skeleton loading, and offset pagination. Pass `selection` to add a
 * checkbox column for bulk actions — pair it with a
 * `TableToolbar.BulkActionsBar` (rendered via the `toolbar` prop) to show
 * "N selected" plus your own bulk actions (delete, export, ...) once
 * `selection.selectedIds` isn't empty.
 */
export function DataTable<TData extends Record<string, any>>({
  data,
  columns,
  pagination,
  isLoading = false,
  toolbar,
  emptyMessage = "No data available.",
  emptyState,
  onRowClick,
  selection,
  className,
}: DataTableProps<TData>) {
  "use no memo";
  const table = useTable({
    columns,
    data,
    features: dataTableFeatures,
  });

  const rows = table.getRowModel().rows;
  const isEmpty = !isLoading && rows.length === 0;
  const colCount = columns.length + (selection ? 1 : 0);

  const pageRowIds = selection
    ? rows.map((row) => selection.getRowId(row.original))
    : [];
  const selectedOnPageCount = selection
    ? pageRowIds.filter((id) => selection.selectedIds.has(id)).length
    : 0;
  const allOnPageSelected = selection
    ? pageRowIds.length > 0 && selectedOnPageCount === pageRowIds.length
    : false;
  const someOnPageSelected = selectedOnPageCount > 0 && !allOnPageSelected;

  const toggleRow = (id: string, checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    selection.onSelectedIdsChange(next);
  };

  const toggleAllOnPage = (checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    for (const id of pageRowIds) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    selection.onSelectedIdsChange(next);
  };

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 w-full flex-1 flex-col gap-4",
        className,
      )}
    >
      {toolbar && (
        <div className="flex shrink-0 items-center gap-3 flex-wrap">
          {toolbar}
        </div>
      )}

      {pagination && (
        <Pagination
          className="shrink-0"
          onPageChange={pagination.onPageChange}
          page={pagination.page}
          pageCount={pagination.pageCount}
          pageSize={pagination.pageSize}
          total={pagination.total}
        />
      )}
      <div className="w-full min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-background">
        <table
          className="w-full text-sm"
          style={{
            minWidth: table.getTotalSize(),
          }}
        >
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr
                // `bg-background` (opaque), not `bg-muted` — `--muted` is a
                // translucent hover tint by design, which let scrolled rows
                // show through this sticky header.
                className="sticky top-0 z-10 border-b border-border bg-background"
                key={hg.id}
              >
                {selection && (
                  <th className="w-10 px-4 py-3">
                    <Checkbox
                      checked={allOnPageSelected}
                      indeterminate={someOnPageSelected}
                      onCheckedChange={toggleAllOnPage}
                    >
                      <Checkbox.Toggle />
                      <Checkbox.Label className="sr-only">
                        Select all rows on this page
                      </Checkbox.Label>
                    </Checkbox>
                  </th>
                )}
                {hg.headers.map((header) => (
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold font-primary text-muted-foreground tracking-wide whitespace-nowrap"
                    key={header.id}
                    style={{
                      minWidth: header.column.getSize(),
                    }}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading && (
              <SkeletonRows
                colCount={columns.length}
                hasSelection={!!selection}
              />
            )}
            {isEmpty && (
              <tr>
                <td colSpan={colCount}>
                  {emptyState ?? (
                    <p className="px-4 py-14 text-center text-sm font-primary text-muted-foreground">
                      {emptyMessage}
                    </p>
                  )}
                </td>
              </tr>
            )}
            {!isLoading &&
              rows.map((row) => {
                const rowId = selection?.getRowId(row.original);
                return (
                  <tr
                    className={cn(
                      "border-b border-border last:border-0 hover:bg-muted transition-colors duration-150",
                      onRowClick && "cursor-pointer",
                    )}
                    key={row.id}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {selection && rowId !== undefined && (
                      <td
                        className="px-4 py-3"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={selection.selectedIds.has(rowId)}
                          onCheckedChange={(checked) =>
                            toggleRow(rowId, checked)
                          }
                        >
                          <Checkbox.Toggle />
                          <Checkbox.Label className="sr-only">
                            Select row
                          </Checkbox.Label>
                        </Checkbox>
                      </td>
                    )}
                    {row.getAllCells().map((cell) => (
                      <td
                        className="px-4 py-3 text-foreground font-primary"
                        key={cell.id}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
