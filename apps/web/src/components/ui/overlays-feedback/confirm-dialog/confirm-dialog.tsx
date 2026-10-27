"use client";

import { type LucideIcon, TriangleAlert } from "lucide-react";
import * as React from "react";
import { Button } from "../../actions-controls/button/button";
import { Icon } from "../../foundations/icon/icon";
import { cn } from "../../utils/tailwind/cn";
import { Modal } from "../modal/modal";

/** Tone of a `ConfirmDialog`: `"destructive"` for irreversible actions (delete, remove, revoke). */
export type ConfirmDialogVariant = "default" | "destructive";

/** Texts rendered by `ConfirmDialog`'s buttons. Pass `lang` to `ConfirmDialog.Root` to override any of them. */
export interface ConfirmDialogLang {
  /** Label of the button that dismisses the dialog. */
  cancel: string;
  /** Label of the button that confirms the action. */
  confirm: string;
}

/** English defaults for `ConfirmDialogLang`. */
export const defaultConfirmDialogLang: ConfirmDialogLang = {
  cancel: "Cancel",
  confirm: "Confirm",
};

interface ConfirmDialogContextValue {
  readonly lang: ConfirmDialogLang;
  readonly variant: ConfirmDialogVariant;
  readonly titleId: string;
  readonly descriptionId: string;
  readonly pending: boolean;
  readonly confirm: () => Promise<void>;
  readonly close: () => void;
}

const ConfirmDialogContext =
  React.createContext<ConfirmDialogContextValue | null>(null);

function useConfirmDialogContext() {
  const context = React.useContext(ConfirmDialogContext);
  if (!context) {
    throw new Error(
      "ConfirmDialog subcomponents must be used within <ConfirmDialog.Root>.",
    );
  }
  return context;
}

export interface ConfirmDialogRootProps {
  children: React.ReactNode;
  /**
   * `"destructive"` colors the confirm button and the optional `ConfirmDialog.Icon` as a warning of irreversible loss.
   * @default "default"
   */
  variant?: ConfirmDialogVariant;
  /**
   * Called when the user confirms. May be async: the confirm button shows a spinner and the dialog stays open until the returned promise resolves, then closes. If it rejects, the dialog stays open and the rejection propagates.
   */
  onConfirm?: () => void | Promise<void>;
  /**
   * Texts rendered by the buttons. Merges over English defaults.
   * @default defaultConfirmDialogLang
   */
  lang?: Partial<ConfirmDialogLang>;
  /** Open state, for controlled usage. */
  open?: boolean;
  /** Initial open state, for uncontrolled usage. @default false */
  defaultOpen?: boolean;
  /** Called whenever the open state changes, controlled or not. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Compound confirmation dialog — a small `alertdialog` that interrupts to ask
 * "are you sure?" before an action that is hard to undo. Built on `Modal`
 * (overlay, focus trap, Escape, stacking), but initial focus lands on
 * `ConfirmDialog.Cancel` — the safe choice — and the backdrop still dismisses
 * it, treated as cancel.
 * @example
 * ```tsx
 * <ConfirmDialog.Root variant="destructive" onConfirm={deleteProject}>
 *   <ConfirmDialog.Trigger>
 *     <Button variant="destructive"><Button.Text>Delete project</Button.Text></Button>
 *   </ConfirmDialog.Trigger>
 *   <ConfirmDialog.Content>
 *     <ConfirmDialog.Icon />
 *     <ConfirmDialog.Title>Delete this project?</ConfirmDialog.Title>
 *     <ConfirmDialog.Description>This permanently removes 24 files. It can't be undone.</ConfirmDialog.Description>
 *     <ConfirmDialog.Footer>
 *       <ConfirmDialog.Cancel />
 *       <ConfirmDialog.Confirm>Delete</ConfirmDialog.Confirm>
 *     </ConfirmDialog.Footer>
 *   </ConfirmDialog.Content>
 * </ConfirmDialog.Root>
 * ```
 */
function ConfirmDialogRoot({
  children,
  variant = "default",
  onConfirm,
  lang,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
}: ConfirmDialogRootProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const [pending, setPending] = React.useState(false);
  const titleId = React.useId();
  const descriptionId = React.useId();

  const setOpen = React.useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalOpen(value);
      onOpenChange?.(value);
    },
    [
      isControlled,
      onOpenChange,
    ],
  );

  const confirm = React.useCallback(async () => {
    setPending(true);
    try {
      await onConfirm?.();
      setOpen(false);
    } finally {
      setPending(false);
    }
  }, [
    onConfirm,
    setOpen,
  ]);

  const resolvedLang = React.useMemo(
    () => ({
      ...defaultConfirmDialogLang,
      ...lang,
    }),
    [
      lang,
    ],
  );

  const value = React.useMemo<ConfirmDialogContextValue>(
    () => ({
      close: () => setOpen(false),
      confirm,
      descriptionId,
      lang: resolvedLang,
      pending,
      titleId,
      variant,
    }),
    [
      confirm,
      descriptionId,
      pending,
      resolvedLang,
      setOpen,
      titleId,
      variant,
    ],
  );

  return (
    <ConfirmDialogContext.Provider value={value}>
      <Modal.Root
        onOpenChange={setOpen}
        open={open}
      >
        {children}
      </Modal.Root>
    </ConfirmDialogContext.Provider>
  );
}

export interface ConfirmDialogTriggerProps {
  /** A single element (e.g. a `Button`) that opens the dialog on click. */
  children: React.ReactElement<{
    onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  }>;
}

/** Clones `children` and wires an `onClick` that opens the dialog. */
function ConfirmDialogTrigger({ children }: ConfirmDialogTriggerProps) {
  return <Modal.Trigger>{children}</Modal.Trigger>;
}

export interface ConfirmDialogContentProps {
  children: React.ReactNode;
  /** Additional classes for the dialog surface. */
  className?: string;
}

/** Portaled `alertdialog` surface, named by `ConfirmDialog.Title` and described by `ConfirmDialog.Description`. Left-aligned and narrow (`max-w-md`) so the question reads at a glance. */
function ConfirmDialogContent({
  children,
  className,
}: ConfirmDialogContentProps) {
  const { titleId, descriptionId } = useConfirmDialogContext();

  return (
    <Modal.Content
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={cn("max-w-md p-6", className)}
      role="alertdialog"
    >
      {children}
    </Modal.Content>
  );
}

export interface ConfirmDialogIconProps {
  /** Icon to show. @default a warning triangle */
  icon?: LucideIcon;
  /** Additional classes for the icon tile. */
  className?: string;
}

/** Optional leading icon tile above the title. Tinted with the semantic tone for `variant="destructive"`, neutral otherwise. */
function ConfirmDialogIcon({
  icon = TriangleAlert,
  className,
}: ConfirmDialogIconProps) {
  const { variant } = useConfirmDialogContext();

  return (
    <span
      aria-hidden="true"
      className={cn(
        "mb-4 flex size-10 items-center justify-center rounded-full",
        variant === "destructive"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-foreground",
        className,
      )}
    >
      <Icon
        icon={icon}
        size="lg"
      />
    </span>
  );
}

export interface ConfirmDialogTitleProps
  extends React.HTMLAttributes<HTMLHeadingElement> {}

/** The question — name what will happen, not "Are you sure?". */
function ConfirmDialogTitle({ className, ...props }: ConfirmDialogTitleProps) {
  const { titleId } = useConfirmDialogContext();

  return (
    <h2
      className={cn(
        "font-primary text-lg font-semibold text-foreground",
        className,
      )}
      id={titleId}
      {...props}
    />
  );
}

export interface ConfirmDialogDescriptionProps
  extends React.HTMLAttributes<HTMLParagraphElement> {}

/** The consequence, in plain terms — what is affected and whether it can be undone. */
function ConfirmDialogDescription({
  className,
  ...props
}: ConfirmDialogDescriptionProps) {
  const { descriptionId } = useConfirmDialogContext();

  return (
    <p
      className={cn(
        "mt-1.5 font-primary text-sm text-muted-foreground",
        className,
      )}
      id={descriptionId}
      {...props}
    />
  );
}

export interface ConfirmDialogFooterProps
  extends React.HTMLAttributes<HTMLDivElement> {}

/** Action row. Stacks on mobile with the primary action on top, and sits end-aligned from `sm` up. */
function ConfirmDialogFooter({
  className,
  ...props
}: ConfirmDialogFooterProps) {
  return (
    <div
      className={cn(
        "mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export interface ConfirmDialogCancelProps
  extends Omit<React.ComponentProps<typeof Button>, "variant"> {}

/** Dismisses the dialog without confirming. Defaults its text to `lang.cancel`. Disabled while a confirmation is pending. */
function ConfirmDialogCancel({
  children,
  onClick,
  ...props
}: ConfirmDialogCancelProps) {
  const { lang, close, pending } = useConfirmDialogContext();

  return (
    <Button
      disabled={pending}
      onClick={(event) => {
        onClick?.(event);
        close();
      }}
      type="button"
      variant="secondary"
      {...props}
    >
      <Button.Text>{children ?? lang.cancel}</Button.Text>
    </Button>
  );
}

export interface ConfirmDialogConfirmProps
  extends Omit<React.ComponentProps<typeof Button>, "variant" | "loading"> {}

/** Confirms the action and runs `onConfirm`. Defaults its text to `lang.confirm`; uses the destructive style when the dialog's `variant` is `"destructive"`, and shows a spinner while `onConfirm` is pending. */
function ConfirmDialogConfirm({
  children,
  onClick,
  ...props
}: ConfirmDialogConfirmProps) {
  const { lang, variant, confirm, pending } = useConfirmDialogContext();

  return (
    <Button
      loading={pending}
      onClick={(event) => {
        onClick?.(event);
        void confirm();
      }}
      type="button"
      variant={variant === "destructive" ? "destructive" : "primary"}
      {...props}
    >
      <Button.Text>{children ?? lang.confirm}</Button.Text>
    </Button>
  );
}

export const ConfirmDialog = {
  Cancel: ConfirmDialogCancel,
  Confirm: ConfirmDialogConfirm,
  Content: ConfirmDialogContent,
  Description: ConfirmDialogDescription,
  Footer: ConfirmDialogFooter,
  Icon: ConfirmDialogIcon,
  Root: ConfirmDialogRoot,
  Title: ConfirmDialogTitle,
  Trigger: ConfirmDialogTrigger,
};
