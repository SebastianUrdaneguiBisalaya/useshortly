"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";
import { isOutsideDismissPending } from "../../utils/overlay/overlayStack";
import { cn } from "../../utils/tailwind/cn";
import { Modal, useDialogTransition, useModalContext } from "../modal/modal";

type DrawerContentProps = {
  /** Drawer panel content: `Drawer.Header`, `Drawer.Body`, `Drawer.Footer`. */
  children: ReactNode;
  /** Additional classes for the sliding panel. */
  className?: string;
};

/**
 * Portaled side panel that slides in from the right, over a dimmed overlay. Closes on overlay click or Escape;
 * when opened over (or under) another Modal/Drawer, it stacks above it and Escape closes the topmost first.
 */
function Content({ children, className }: DrawerContentProps) {
  const { open, setOpen } = useModalContext();
  const { mounted, visible, animate, zIndex } = useDialogTransition(
    open,
    () => setOpen(false),
    420,
  );

  if (!mounted || !visible) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex"
      style={{
        zIndex,
      }}
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 bg-overlay transition-opacity duration-420 ease-in-out",
          animate ? "opacity-100" : "opacity-0",
        )}
        onClick={() => {
          if (!isOutsideDismissPending()) setOpen(false);
        }}
      />
      <div
        aria-modal="true"
        className={cn(
          "absolute right-0 top-0 h-full w-full sm:max-w-md border-l border-border bg-background text-foreground shadow-2xl flex flex-col",
          "transition-transform duration-420 ease-[cubic-bezier(0.25,0.46,0.45,0.94)]",
          animate ? "translate-x-0" : "translate-x-full",
          className,
        )}
        role="dialog"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Top bar of the drawer: title/description on the start, actions (e.g. a close button) on the end. */
function Header({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-5 py-4 border-b border-border shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/** Scrollable main area between `Header` and `Footer`. */
function Body({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex-1 overflow-y-auto px-5 py-5", className)}
      {...props}
    />
  );
}

/** Pinned bar at the bottom of the drawer, for actions. */
function Footer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shrink-0 px-5 py-4 border-t border-border", className)}
      {...props}
    />
  );
}

/** Drawer heading. */
function Title({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "text-base font-bold font-primary text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Supporting text under `Title`. */
function Description({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-muted-foreground font-primary", className)}
      {...props}
    />
  );
}

/**
 * Compound side drawer. Shares `Root`/`Trigger`/`Close` (and open state) with `Modal`.
 * @example
 * ```tsx
 * <Drawer.Root>
 *   <Drawer.Trigger><Button><Button.Text>Open</Button.Text></Button></Drawer.Trigger>
 *   <Drawer.Content>
 *     <Drawer.Header><Drawer.Title>Details</Drawer.Title></Drawer.Header>
 *     <Drawer.Body>…</Drawer.Body>
 *   </Drawer.Content>
 * </Drawer.Root>
 * ```
 */
export const Drawer = {
  Body,
  Close: Modal.Close,
  Content,
  Description,
  Footer,
  Header,
  Root: Modal.Root,
  Title,
  Trigger: Modal.Trigger,
};
