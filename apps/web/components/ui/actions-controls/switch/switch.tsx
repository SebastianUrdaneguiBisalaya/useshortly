"use client";

import * as React from "react";
import { cn } from "../../utils/tailwind/cn";

interface SwitchContextValue {
  readonly id: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}

const SwitchContext = React.createContext<SwitchContextValue | null>(null);

function useSwitchContext() {
  const ctx = React.useContext(SwitchContext);
  if (!ctx)
    throw new Error("Switch subcomponents must be used within Switch.Root");
  return ctx;
}

interface SwitchRootProps {
  /** Checked state, for controlled usage. */
  readonly checked?: boolean;
  /** Initial checked state, for uncontrolled usage. @default false */
  readonly defaultChecked?: boolean;
  /** Called with the new checked state whenever it changes. */
  readonly onCheckedChange?: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly children?: React.ReactNode;
  readonly className?: string;
}

/**
 * Root of the compound switch. Groups `Switch.Toggle` with `Switch.Label`,
 * wiring them together via `id`/`htmlFor`. There's no standalone
 * label prop on `Switch.Toggle` itself (unlike `Input`/`Select`/`DatePicker`)
 * — a bare toggle is meant to sit inline next to arbitrary content, so it's
 * always labeled explicitly through this wrapper.
 * @example
 * ```tsx
 * <Switch.Root defaultChecked={false} onCheckedChange={setEnabled}>
 *   <Switch.Label>Notifications</Switch.Label>
 *   <Switch.Toggle />
 * </Switch.Root>
 * ```
 */
function Root({
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  children,
  className,
}: SwitchRootProps) {
  const id = React.useId();
  const [uncontrolledChecked, setUncontrolledChecked] =
    React.useState(defaultChecked);
  const isControlled = checked !== undefined;
  const isChecked = isControlled ? checked : uncontrolledChecked;

  const handleCheckedChange = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledChecked(next);
      onCheckedChange?.(next);
    },
    [
      isControlled,
      onCheckedChange,
    ],
  );

  const value = React.useMemo(
    () => ({
      checked: isChecked,
      disabled,
      id,
      onCheckedChange: handleCheckedChange,
    }),
    [
      id,
      isChecked,
      handleCheckedChange,
      disabled,
    ],
  );

  return (
    <SwitchContext.Provider value={value}>
      <div className={cn("flex items-center justify-between gap-3", className)}>
        {children}
      </div>
    </SwitchContext.Provider>
  );
}

export interface SwitchToggleProps {
  className?: string;
}

/** The switch control itself (WAI-ARIA `switch` pattern). Must be used inside `Switch.Root`. */
function Toggle({ className }: SwitchToggleProps) {
  const { id, checked, onCheckedChange, disabled } = useSwitchContext();

  return (
    <button
      aria-checked={checked}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent",
        "transition-colors duration-150 ease-in-out",
        "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-foreground" : "bg-muted",
        className,
      )}
      data-state={checked ? "checked" : "unchecked"}
      disabled={disabled}
      id={id}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm",
          "transform transition-transform duration-150 ease-in-out",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

export interface SwitchLabelProps {
  children: React.ReactNode;
  className?: string;
}

/** Label for the `Switch.Toggle` inside the same `Switch.Root`. */
function Label({ children, className }: SwitchLabelProps) {
  const { id } = useSwitchContext();
  return (
    <label
      className={cn(
        "cursor-pointer select-none text-sm font-medium font-primary text-foreground",
        className,
      )}
      htmlFor={id}
    >
      {children}
    </label>
  );
}

export const Switch = Object.assign(Root, {
  Label,
  Toggle,
});
