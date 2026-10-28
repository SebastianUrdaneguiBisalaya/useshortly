"use client";

import * as React from "react";

import { cn } from "../../utils/tailwind/cn";

interface DocsTocContextValue {
  readonly activeId: string | undefined;
}

const DocsTocContext = React.createContext<DocsTocContextValue | null>(null);

function useDocsTocContext() {
  const context = React.useContext(DocsTocContext);
  if (!context) {
    throw new Error("DocsToc.Item must be used within <DocsToc>.");
  }
  return context;
}

export interface DocsTocItemProps {
  /** Must match the `id` of the corresponding section element elsewhere on the page — that's how `DocsToc` finds it to track. */
  id: string;
  /** Section title shown in the hover panel, and this tick's accessible name. */
  title: string;
}

export interface DocsTocProps {
  /** One `DocsToc.Item` per section, in document order. */
  children: React.ReactNode;
  /**
   * Accessible name of the table of contents.
   * @default "On this page"
   */
  "aria-label"?: string;
  className?: string;
}

/**
 * Compound floating table of contents — the Notion-style pattern: a compact
 * column of thin tick marks fixed to the right edge, highlighting whichever
 * section is currently in view (tracked via `IntersectionObserver`, matched
 * against each `DocsToc.Item`'s `id`). Hovering the column reveals a panel
 * listing every section's title — titles truncate to one line rather than
 * wrapping, and the panel itself scrolls instead of growing past a maximum
 * height when there are many sections. Desktop only (`lg:` and up) — there's
 * no room for a floating side rail once the page is narrow enough that
 * content already fills the viewport width.
 *
 * `DocsToc` only renders the rail/panel — it doesn't own or render the
 * sections it tracks. Those are the page's own content elsewhere, each just
 * needing an `id` matching one `DocsToc.Item`; compose them from whatever
 * this library or the app already uses for a page section (e.g.
 * `Layout.Section` for the wrapper, `BlockCode` for a code sample inside it).
 * @example
 * ```tsx
 * <DocsToc>
 *   <DocsToc.Item id="install" title="Install" />
 *   <DocsToc.Item id="usage" title="Usage" />
 * </DocsToc>
 *
 * <Layout.Section id="install">
 *   <h2>Install</h2>
 *   <BlockCode.Root code="pnpm add ui-components" language="bash">
 *     <BlockCode.Content />
 *   </BlockCode.Root>
 * </Layout.Section>
 * <Layout.Section id="usage">
 *   <h2>Usage</h2>
 *   <p>...</p>
 * </Layout.Section>
 * ```
 */
function DocsTocRoot({
  children,
  className,
  "aria-label": ariaLabel = "On this page",
}: DocsTocProps) {
  const items = React.useMemo(
    () =>
      React.Children.toArray(children)
        .filter(React.isValidElement<DocsTocItemProps>)
        .map((child) => child.props),
    [
      children,
    ],
  );
  const ids = React.useMemo(
    () => items.map((item) => item.id),
    [
      items,
    ],
  );

  const [activeId, setActiveId] = React.useState<string | undefined>(ids[0]);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        );
        setActiveId(topMost.target.id);
      },
      {
        rootMargin: "-15% 0px -70% 0px",
        threshold: 0,
      },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [
    ids,
  ]);

  const value = React.useMemo<DocsTocContextValue>(
    () => ({
      activeId,
    }),
    [
      activeId,
    ],
  );

  return (
    <DocsTocContext.Provider value={value}>
      <nav
        aria-label={ariaLabel}
        className={cn(
          "fixed top-1/2 right-6 z-20 hidden -translate-y-1/2 lg:block",
          className,
        )}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        <ul className="flex flex-col items-end gap-1 py-2 pl-3">{children}</ul>

        {expanded && (
          <div
            className="absolute top-1/2 right-0 max-h-[min(70vh,28rem)] w-52 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-background/95 p-1.5 shadow-lg backdrop-blur-sm"
            data-testid="docs-toc-panel"
          >
            <ul className="flex flex-col">
              {items.map((item, position) => (
                <li key={item.id}>
                  <a
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 py-1.5 font-secondary text-xs text-muted-foreground transition-colors duration-150 ease-in-out",
                      "hover:bg-muted hover:text-foreground",
                      "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
                      activeId === item.id && "text-foreground",
                    )}
                    href={`#${item.id}`}
                  >
                    <span
                      aria-hidden="true"
                      className="shrink-0 tabular-nums text-muted-foreground"
                    >
                      {String(position).padStart(2, "0")}
                    </span>
                    <span className="truncate">{item.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
    </DocsTocContext.Provider>
  );
}

/** One section's tick mark on the rail — a thin line that grows and fills once its section is active. */
function DocsTocItem({ id, title }: DocsTocItemProps) {
  const { activeId } = useDocsTocContext();
  const active = activeId === id;

  return (
    <li>
      <a
        aria-label={title}
        className={cn(
          "group flex items-center py-px",
          "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
        )}
        href={`#${id}`}
      >
        <span
          className={cn(
            "h-px rounded-full bg-border-strong transition-all duration-200 ease-in-out",
            active
              ? "w-5 bg-foreground"
              : "w-2.5 group-hover:w-3.5 group-hover:bg-muted-foreground",
          )}
        />
      </a>
    </li>
  );
}

export const DocsToc = Object.assign(DocsTocRoot, {
  Item: DocsTocItem,
});

/**
 * Next.js's Server/Client boundary only resolves top-level exports of a
 * "use client" module into client references — `DocsToc.Item` (a property
 * access on the compound object) resolves to `undefined` when used from a
 * Server Component. This named export is the escape hatch for that case;
 * `DocsToc.Item` still works fine from any other client component.
 */
export { DocsTocItem };
