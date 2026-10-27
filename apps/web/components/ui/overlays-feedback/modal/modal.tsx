"use client";

import {
  cloneElement,
  createContext,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  claimOverlayLayer,
  registerEscapeHandler,
} from "../../utils/overlay/overlayStack";
import { cn } from "../../utils/tailwind/cn";

type ModalContextType = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const ModalContext = createContext<ModalContextType | null>(null);

export function useModalContext() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("useModalContext must be used within a ModalProvider");
  }
  return context;
}

/**
 * Closes an open overlay (Modal, Drawer, Popover, Dropdown…) on Escape. Overlays are stacked: only the one that
 * opened last reacts, so nested overlays close one at a time, innermost first.
 */
export function useEscapeKey(open: boolean, onClose: () => void): void {
  const handler = useRef(onClose);

  useEffect(() => {
    handler.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    return registerEscapeHandler(handler);
  }, [
    open,
  ]);
}

const OVERLAY_BASE_Z_INDEX = 120;
const OVERLAY_Z_INDEX_STEP = 10;

/**
 * Layering for stacked overlays: returns a `z-index` that is above every overlay already open, so a Modal opened
 * from inside a Drawer (or the other way around) always lands on top without any manual `z-*` override.
 */
function useOverlayLayer(active: boolean): number {
  const [layer, setLayer] = useState(0);

  useEffect(() => {
    if (!active) return;
    const claim = claimOverlayLayer();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayer(claim.layer);
    return claim.release;
  }, [
    active,
  ]);

  return OVERLAY_BASE_Z_INDEX + layer * OVERLAY_Z_INDEX_STEP;
}

interface DialogTransitionState {
  mounted: boolean;
  visible: boolean;
  animate: boolean;
  /** `z-index` for the overlay's wrapper, above every other overlay that is open. */
  zIndex: number;
}

/**
 * Shared mount/visible/animate state machine + escape-key handling + stacking
 * behind CSS-transitioned overlays (Modal, Drawer). Keeps one behavioral source
 * of truth so each surface only has to own its own visual shell.
 */
export function useDialogTransition(
  open: boolean,
  onClose: () => void,
  exitDurationMs = 300,
): DialogTransitionState {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [animate, setAnimate] = useState(false);
  const zIndex = useOverlayLayer(visible);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimate(true);
        });
      });
    } else {
      setAnimate(false);
      const timeout = setTimeout(() => {
        setVisible(false);
      }, exitDurationMs);
      return () => clearTimeout(timeout);
    }
  }, [
    open,
    exitDurationMs,
  ]);

  useEscapeKey(open, onClose);

  return {
    animate,
    mounted,
    visible,
    zIndex,
  };
}

type ModalRootProps = {
  children: ReactNode;
  /** Initial open state for uncontrolled usage. @default false */
  defaultOpen?: boolean;
  /** Open state for controlled usage. */
  open?: boolean;
  /** Called whenever the open state changes, controlled or not. */
  onOpenChange?: (open: boolean) => void;
};

/** Root of the compound modal; owns open/closed state and provides it to `Trigger`/`Content`/`Close`. */
function Root({
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
}: ModalRootProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (value: boolean) => {
      if (!isControlled) {
        setInternalOpen(value);
      }
      onOpenChange?.(value);
    },
    [
      isControlled,
      onOpenChange,
    ],
  );

  const value = useMemo(
    () => ({
      open,
      setOpen,
    }),
    [
      open,
      setOpen,
    ],
  );

  return (
    <ModalContext.Provider value={value}>{children}</ModalContext.Provider>
  );
}

type TriggerChildProps = {
  onClick?: (event: MouseEvent<HTMLElement>) => void;
};

type ModalTriggerProps = {
  /** A single element (e.g. a `Button`) that opens the modal on click. */
  children: ReactElement<TriggerChildProps>;
};

/** Clones `children` and wires an `onClick` that opens the modal, preserving any existing handler. */
function Trigger({ children }: ModalTriggerProps) {
  const { setOpen } = useModalContext();
  return cloneElement(children, {
    onClick: (event: MouseEvent<HTMLElement>) => {
      children.props.onClick?.(event);
      setOpen(true);
    },
  });
}

type ModalContentProps = {
  children: ReactNode;
  className?: string;
  /** Additional classes for the dimming backdrop behind the dialog. */
  overlayClassName?: string;
  /**
   * Additional classes for the full-screen wrapper. Stacking is automatic (a Modal opened over a Drawer, or over
   * another Modal, renders above it), so no `z-*` override is needed for nesting.
   */
  wrapperClassName?: string;
  /**
   * ARIA role of the dialog surface. Use `"alertdialog"` for an interruption that demands a response (e.g. a destructive confirmation).
   * @default "dialog"
   */
  role?: "dialog" | "alertdialog";
  /** `id` of the element naming the dialog (usually its `Modal.Title`). */
  "aria-labelledby"?: string;
  /** `id` of the element describing the dialog (usually its `Modal.Description`). */
  "aria-describedby"?: string;
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Traps Tab/Shift+Tab inside `ref`, focuses its first focusable element on open, and restores focus to whatever was focused before on close. */
export function useFocusTrap(
  active: boolean,
  ref: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = node?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? node)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !node) return;
      const elements = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (elements.length === 0) return;

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [
    active,
    ref,
  ]);
}

/** Portaled dialog surface: dimmed overlay + focus-trapped, animated content panel. Closes on overlay click or Escape. */
function Content({
  children,
  className,
  overlayClassName,
  wrapperClassName,
  role = "dialog",
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: ModalContentProps) {
  const { open, setOpen } = useModalContext();
  const { mounted, visible, animate, zIndex } = useDialogTransition(open, () =>
    setOpen(false),
  );
  const contentRef = useRef<HTMLDivElement>(null);
  useFocusTrap(visible, contentRef);

  if (!mounted || !visible) {
    return null;
  }
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center p-6",
        wrapperClassName,
      )}
      style={{
        zIndex,
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: overlay de fondo, requiere ser un div de posicionamiento absoluto, no un <button> */}
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 bg-overlay transition-opacity duration-300 ease-out",
          animate ? "opacity-100 ease-out" : "opacity-0 ease-in",
          overlayClassName,
        )}
        onClick={() => setOpen(false)}
        role="button"
        tabIndex={-1}
      />
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: `role` is always `dialog` or `alertdialog`, both of which support these ARIA props. */}
      <div
        aria-describedby={ariaDescribedBy}
        aria-labelledby={ariaLabelledBy}
        aria-modal="true"
        className={cn(
          "relative z-50 w-full max-w-lg rounded-lg border border-border bg-background p-6 text-foreground shadow-lg",
          "transition-all duration-300",
          animate
            ? "translate-y-0 scale-100 opacity-100 ease-out"
            : "translate-y-2 scale-95 opacity-0 ease-in",
          className,
        )}
        ref={contentRef}
        role={role}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Groups `Title`/`Description` at the top of the dialog. */
function Header({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col space-y-1.5", className)}
      {...props}
    />
  );
}

/** Main scrollable content area between `Header` and `Footer`. */
function Body({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("py-4", className)}
      {...props}
    />
  );
}

/** Right-aligned row of actions at the bottom of the dialog. */
function Footer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-end gap-2", className)}
      {...props}
    />
  );
}

/** Dialog heading. */
function Title({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "text-lg font-semibold font-primary text-foreground",
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
      className={cn("text-sm font-primary text-muted-foreground", className)}
      {...props}
    />
  );
}

type ModalCloseProps = {
  /** A single element (e.g. a `Button`) that closes the modal on click. */
  children: ReactElement<TriggerChildProps>;
};

/** Clones `children` and wires an `onClick` that closes the modal, preserving any existing handler. */
function Close({ children }: ModalCloseProps) {
  const { setOpen } = useModalContext();

  return cloneElement(children, {
    onClick: (event: MouseEvent<HTMLElement>) => {
      children.props.onClick?.(event);

      setOpen(false);
    },
  });
}

/**
 * Compound modal dialog.
 * @example
 * ```tsx
 * <Modal.Root>
 *   <Modal.Trigger><Button><Button.Text>Open</Button.Text></Button></Modal.Trigger>
 *   <Modal.Content>
 *     <Modal.Header><Modal.Title>Delete item</Modal.Title></Modal.Header>
 *     <Modal.Footer><Modal.Close><Button variant="secondary"><Button.Text>Cancel</Button.Text></Button></Modal.Close></Modal.Footer>
 *   </Modal.Content>
 * </Modal.Root>
 * ```
 */
export const Modal = {
  Body,
  Close,
  Content,
  Description,
  Footer,
  Header,
  Root,
  Title,
  Trigger,
};
