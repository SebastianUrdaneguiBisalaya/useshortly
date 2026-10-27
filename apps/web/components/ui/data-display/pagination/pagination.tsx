"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type * as React from "react";
import { Icon } from "../../foundations/icon/icon";
import { cn } from "../../utils/tailwind/cn";

/** Texts rendered by `Pagination`. Pass `lang` to override any of them. */
export interface PaginationLang {
  /** Accessible label for the `<nav>` landmark. */
  navigationLabel: string;
  /** Accessible name/tooltip of the "first page" button. */
  firstPage: string;
  /** Accessible name/tooltip of the "previous page" button. */
  previousPage: string;
  /** Accessible name/tooltip of a numbered page button. */
  page: (page: number) => string;
  /** Accessible name/tooltip of the "next page" button. */
  nextPage: string;
  /** Accessible name/tooltip of the "last page" button. */
  lastPage: string;
  /** The "Showing X–Y of Z results" summary, given the first/last visible row and the total. */
  summary: (from: number, to: number, total: number) => React.ReactNode;
}

/** English defaults for `PaginationLang`. */
export const defaultPaginationLang: PaginationLang = {
  firstPage: "First page",
  lastPage: "Last page",
  navigationLabel: "Pagination",
  nextPage: "Next page",
  page: (page) => `Page ${page}`,
  previousPage: "Previous page",
  summary: (from, to, total) => (
    <>
      Showing{" "}
      <span className="font-semibold text-foreground">{from}</span>
      {" – "}
      <span className="font-semibold text-foreground">{to}</span>
      {" of "}
      <span className="font-semibold text-foreground">{total}</span>
      {" results"}
    </>
  ),
};

export interface PaginationProps {
  /** 1-based index of the page currently rendered. */
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  /** Total pages, if known directly (e.g. server-computed). Otherwise derived from `total`/`pageSize`. */
  readonly pageCount?: number;
  readonly onPageChange: (page: number) => void;
  /**
   * Texts rendered by this component. Merges over English defaults.
   * @default defaultPaginationLang
   */
  readonly lang?: Partial<PaginationLang>;
  readonly className?: string;
}

function generatePageNumbers(
  current: number,
  total: number,
): (number | "ellipsis")[] {
  if (total <= 7)
    return Array.from(
      {
        length: total,
      },
      (_, i) => i + 1,
    );
  if (current <= 4)
    return [
      1,
      2,
      3,
      4,
      5,
      "ellipsis",
      total,
    ];
  if (current >= total - 3)
    return [
      1,
      "ellipsis",
      total - 4,
      total - 3,
      total - 2,
      total - 1,
      total,
    ];
  return [
    1,
    "ellipsis",
    current - 1,
    current,
    current + 1,
    "ellipsis",
    total,
  ];
}

interface PageButtonProps {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  /** Highlights this as the currently selected page. */
  readonly active?: boolean;
  readonly "aria-label"?: string;
  readonly "aria-current"?: React.AriaAttributes["aria-current"];
}

/** One page-number/nav-arrow button. */
function PageButton({
  children,
  onClick,
  disabled = false,
  active = false,
  ...props
}: PageButtonProps) {
  return (
    <button
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg font-primary text-xs transition-all duration-200 ease-in-out",
        "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
        active
          ? "bg-foreground text-background"
          : "text-foreground hover:bg-muted",
        disabled
          ? "cursor-not-allowed opacity-40 pointer-events-none"
          : "cursor-pointer",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Offset pagination control — first/previous/numbered-with-ellipsis/next/last
 * pages plus a "showing X–Y of Z results" summary. This is the exact
 * pagination `DataTable` renders (`DataTable` composes this component
 * directly, so the two can never drift apart into two different-looking
 * paginations).
 */
export function Pagination({
  page,
  pageSize,
  total,
  pageCount,
  onPageChange,
  lang,
  className,
}: PaginationProps) {
  const resolvedLang = { ...defaultPaginationLang, ...lang };
  const resolvedPageCount =
    pageCount ?? Math.max(1, Math.ceil(total / pageSize));
  if (resolvedPageCount <= 1) return null;

  const pageNumbers = generatePageNumbers(page, resolvedPageCount);

  return (
    <div
      className={cn(
        "flex flex-col items-start justify-between gap-4 flex-wrap sm:flex-row sm:items-center",
        className,
      )}
    >
      <p
        aria-live="polite"
        className="text-xs font-primary text-muted-foreground"
      >
        {resolvedLang.summary(
          (page - 1) * pageSize + 1,
          Math.min(page * pageSize, total),
          total,
        )}
      </p>

      <nav
        aria-label={resolvedLang.navigationLabel}
        className="flex items-center"
      >
        <PageButton
          aria-label={resolvedLang.firstPage}
          disabled={page === 1}
          onClick={() => onPageChange(1)}
        >
          <Icon
            icon={ChevronsLeft}
            size="sm"
          />
        </PageButton>
        <PageButton
          aria-label={resolvedLang.previousPage}
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
        >
          <Icon
            icon={ChevronLeft}
            size="sm"
          />
        </PageButton>

        {pageNumbers.map((p, i) =>
          p === "ellipsis" ? (
            <span
              className="select-none px-1 font-primary text-xs text-muted-foreground"
              // biome-ignore lint/suspicious/noArrayIndexKey: two ellipses (left/right) can coexist without their own identity
              key={`ellipsis-${i}`}
            >
              …
            </span>
          ) : (
            <PageButton
              active={p === page}
              aria-current={p === page ? "page" : undefined}
              aria-label={resolvedLang.page(p)}
              key={p}
              onClick={() => onPageChange(p)}
            >
              {p}
            </PageButton>
          ),
        )}

        <PageButton
          aria-label={resolvedLang.nextPage}
          disabled={page === resolvedPageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <Icon
            icon={ChevronRight}
            size="sm"
          />
        </PageButton>
        <PageButton
          aria-label={resolvedLang.lastPage}
          disabled={page === resolvedPageCount}
          onClick={() => onPageChange(resolvedPageCount)}
        >
          <Icon
            icon={ChevronsRight}
            size="sm"
          />
        </PageButton>
      </nav>
    </div>
  );
}
