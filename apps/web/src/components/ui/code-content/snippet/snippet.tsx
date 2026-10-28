"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";
import { Icon } from "../../foundations/icon/icon";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../utils/tailwind/cn";

/** Package managers `Snippet` can switch between out of the box. */
export const snippetPackageManagers = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
] as const;

export type SnippetPackageManager = (typeof snippetPackageManagers)[number];

interface SnippetContextValue {
  readonly commands: Partial<Record<SnippetPackageManager, string>>;
  readonly packageManager: SnippetPackageManager;
  readonly setPackageManager: (packageManager: SnippetPackageManager) => void;
}

const SnippetContext = React.createContext<SnippetContextValue | null>(null);

function useSnippetContext() {
  const context = React.useContext(SnippetContext);
  if (!context) {
    throw new Error(
      "Snippet subcomponents must be used within <Snippet.Root>.",
    );
  }
  return context;
}

function firstAvailable(
  commands: Partial<Record<SnippetPackageManager, string>>,
): SnippetPackageManager {
  return snippetPackageManagers.find((manager) => commands[manager]) ?? "npm";
}

export interface SnippetRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "defaultValue"> {
  /** The command for each package manager it should offer; managers left out don't get a tab. */
  commands: Partial<Record<SnippetPackageManager, string>>;
  /** Active package manager, for controlled usage. */
  packageManager?: SnippetPackageManager;
  /** Initial package manager, for uncontrolled usage. @default the first of `commands` in npm/pnpm/yarn/bun order */
  defaultPackageManager?: SnippetPackageManager;
  /** Called with the newly selected package manager. */
  onPackageManagerChange?: (packageManager: SnippetPackageManager) => void;
}

/**
 * Compound install-command block with a package-manager switcher — the
 * "npm install / pnpm add / yarn add / bun add" tabs shown on package
 * READMEs and doc sites.
 * @example
 * ```tsx
 * <Snippet.Root
 *   commands={{ npm: "npm install zod", pnpm: "pnpm add zod", yarn: "yarn add zod", bun: "bun add zod" }}
 * >
 *   <Snippet.Header>
 *     <Snippet.Tabs />
 *     <Snippet.CopyButton />
 *   </Snippet.Header>
 *   <Snippet.Content />
 * </Snippet.Root>
 * ```
 */
function Root({
  commands,
  packageManager: controlledPackageManager,
  defaultPackageManager,
  onPackageManagerChange,
  className,
  children,
  ...props
}: SnippetRootProps) {
  const [uncontrolledPackageManager, setUncontrolledPackageManager] =
    React.useState<SnippetPackageManager>(
      defaultPackageManager ?? firstAvailable(commands),
    );
  const isControlled = controlledPackageManager !== undefined;
  const packageManager = isControlled
    ? controlledPackageManager
    : uncontrolledPackageManager;

  const setPackageManager = React.useCallback(
    (next: SnippetPackageManager) => {
      if (!isControlled) setUncontrolledPackageManager(next);
      onPackageManagerChange?.(next);
    },
    [
      isControlled,
      onPackageManagerChange,
    ],
  );

  const contextValue = React.useMemo<SnippetContextValue>(
    () => ({
      commands,
      packageManager,
      setPackageManager,
    }),
    [
      commands,
      packageManager,
      setPackageManager,
    ],
  );

  return (
    <SnippetContext.Provider value={contextValue}>
      <div
        className={cn(
          "overflow-hidden rounded-md border border-border bg-muted",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </SnippetContext.Provider>
  );
}

export interface SnippetHeaderProps
  extends React.HTMLAttributes<HTMLDivElement> {}

/** Toolbar row above the command — typically `Snippet.Tabs` and `Snippet.CopyButton`. */
function Header({ className, ...props }: SnippetHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-b border-border px-2 py-1.5",
        className,
      )}
      {...props}
    />
  );
}

/** Texts rendered by `Snippet.Tabs`. Pass `lang` to override any of them. */
export interface SnippetTabsLang {
  /** Accessible label for the tab list. */
  packageManager: string;
}

/** English defaults for `SnippetTabsLang`. */
export const defaultSnippetTabsLang: SnippetTabsLang = {
  packageManager: "Package manager",
};

export interface SnippetTabsProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "lang"> {
  /**
   * Texts rendered by this component. Merges over English defaults.
   * @default defaultSnippetTabsLang
   */
  lang?: Partial<SnippetTabsLang>;
}

/** Package-manager switcher, following the WAI-ARIA Tabs pattern. Only renders a tab for managers `Snippet.Root`'s `commands` actually has. */
function Tabs({ className, lang, ...props }: SnippetTabsProps) {
  const resolvedLang = {
    ...defaultSnippetTabsLang,
    ...lang,
  };
  const { commands, packageManager, setPackageManager } = useSnippetContext();
  const available = snippetPackageManagers.filter(
    (manager) => commands[manager],
  );

  return (
    <div
      aria-label={resolvedLang.packageManager}
      className={cn("flex items-center gap-0.5", className)}
      role="tablist"
      {...props}
    >
      {available.map((manager) => {
        const active = manager === packageManager;
        return (
          <button
            aria-selected={active}
            className={cn(
              "cursor-pointer rounded-sm px-2 py-1 font-secondary text-xs font-medium transition-colors duration-150 ease-in-out",
              "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            key={manager}
            onClick={() => setPackageManager(manager)}
            role="tab"
            type="button"
          >
            {manager}
          </button>
        );
      })}
    </div>
  );
}

/** Texts rendered by `Snippet.CopyButton`. Pass `lang` to override any of them. */
export interface SnippetCopyButtonLang {
  /** Accessible label before copying. */
  copy: string;
  /** Accessible label right after copying. */
  copied: string;
}

/** English defaults for `SnippetCopyButtonLang`. */
export const defaultSnippetCopyButtonLang: SnippetCopyButtonLang = {
  copied: "Copied",
  copy: "Copy command",
};

export interface SnippetCopyButtonProps {
  /**
   * Texts rendered by this component. Merges over English defaults.
   * @default defaultSnippetCopyButtonLang
   */
  lang?: Partial<SnippetCopyButtonLang>;
  className?: string;
}

/** Copies the active package manager's command to the clipboard, showing a brief confirmation. */
function CopyButton({ lang, className }: SnippetCopyButtonProps) {
  const resolvedLang = {
    ...defaultSnippetCopyButtonLang,
    ...lang,
  };
  const { commands, packageManager } = useSnippetContext();
  const { copied, copy } = useCopyToClipboard();

  const handleClick = () => copy(commands[packageManager] ?? "");

  return (
    <button
      aria-label={copied ? resolvedLang.copied : resolvedLang.copy}
      className={cn(
        "flex shrink-0 cursor-pointer items-center justify-center rounded-sm p-1 text-muted-foreground transition-colors duration-150 ease-in-out hover:bg-background hover:text-foreground",
        "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
        className,
      )}
      onClick={handleClick}
      type="button"
    >
      <span
        className="flex animate-fade-scale-in"
        key={copied ? "copied" : "copy"}
      >
        <Icon
          icon={copied ? Check : Copy}
          size="xs"
        />
      </span>
    </button>
  );
}

export interface SnippetContentProps
  extends React.HTMLAttributes<HTMLPreElement> {}

/** Renders the active package manager's command as preformatted monospace text, prefixed with a `$`. */
function Content({ className, ...props }: SnippetContentProps) {
  const { commands, packageManager } = useSnippetContext();

  return (
    <pre
      className={cn(
        "overflow-x-auto px-3 py-2.5 font-secondary text-sm text-foreground",
        className,
      )}
      {...props}
    >
      <code>
        <span
          aria-hidden="true"
          className="select-none text-muted-foreground"
        >
          ${" "}
        </span>
        {commands[packageManager] ?? ""}
      </code>
    </pre>
  );
}

export const Snippet = {
  Content,
  CopyButton,
  Header,
  Root,
  Tabs,
};
