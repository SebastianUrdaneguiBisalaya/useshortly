"use client";

import { Check, Minus } from "lucide-react";
import * as React from "react";
import { Icon } from "../../foundations/icon/icon";
import { cn } from "../../utils/tailwind/cn";

interface CheckboxContextValue {
  readonly id: string;
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}

const CheckboxContext = React.createContext<CheckboxContextValue | null>(null);

function useCheckboxContext() {
  const context = React.useContext(CheckboxContext);
  if (!context) {
    throw new Error(
      "Checkbox subcomponents must be used within Checkbox.Root.",
    );
  }
  return context;
}

export interface CheckboxRootProps {
  /** Checked state, for controlled usage. */
  checked?: boolean;
  /** Initial checked state, for uncontrolled usage. @default false */
  defaultChecked?: boolean;
  /** Renders the "mixed" visual/ARIA state (e.g. a "select all" checkbox with a partial selection). Purely presentational — doesn't affect `checked`. */
  indeterminate?: boolean;
  /** Called with the new checked state whenever it changes. */
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Root of the compound checkbox. Groups `Checkbox.Toggle` with `Checkbox.Label`,
 * wiring them together via `id`/`htmlFor` — mirrors `Switch.Root`.
 * @example
 * ```tsx
 * <Checkbox.Root defaultChecked onCheckedChange={setAccepted}>
 *   <Checkbox.Toggle />
 *   <Checkbox.Label>Accept terms</Checkbox.Label>
 * </Checkbox.Root>
 * ```
 */
function Root({
  checked,
  defaultChecked = false,
  indeterminate = false,
  onCheckedChange,
  disabled,
  children,
  className,
}: CheckboxRootProps) {
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
      indeterminate,
      onCheckedChange: handleCheckedChange,
    }),
    [
      id,
      isChecked,
      indeterminate,
      handleCheckedChange,
      disabled,
    ],
  );

  return (
    <CheckboxContext.Provider value={value}>
      <div className={cn("flex items-center gap-2", className)}>{children}</div>
    </CheckboxContext.Provider>
  );
}

export interface CheckboxToggleProps {
  className?: string;
}

/** The checkbox control itself (WAI-ARIA `checkbox` pattern). Must be used inside `Checkbox.Root`. */
function Toggle({ className }: CheckboxToggleProps) {
  const { id, checked, indeterminate, onCheckedChange, disabled } =
    useCheckboxContext();

  return (
    <button
      aria-checked={indeterminate ? "mixed" : checked}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-sm border border-border transition-colors duration-150 ease-in-out",
        "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
        "disabled:cursor-not-allowed disabled:opacity-50",
        (checked || indeterminate) &&
          "border-transparent bg-foreground text-background",
        !disabled && "cursor-pointer",
        className,
      )}
      data-state={
        indeterminate ? "indeterminate" : checked ? "checked" : "unchecked"
      }
      disabled={disabled}
      id={id}
      onClick={() => onCheckedChange(!checked)}
      role="checkbox"
      type="button"
    >
      {indeterminate ? (
        <Icon
          aria-hidden="true"
          icon={Minus}
          size="xs"
        />
      ) : (
        checked && (
          <Icon
            aria-hidden="true"
            icon={Check}
            size="xs"
          />
        )
      )}
    </button>
  );
}

export interface CheckboxLabelProps {
  children: React.ReactNode;
  className?: string;
}

/** Label for the `Checkbox.Toggle` inside the same `Checkbox.Root`. */
function Label({ children, className }: CheckboxLabelProps) {
  const { id } = useCheckboxContext();
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

export const Checkbox = Object.assign(Root, {
  Label,
  Toggle,
});
