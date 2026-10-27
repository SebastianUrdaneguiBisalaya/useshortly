"use client";

import { Minus, Plus } from "lucide-react";
import * as React from "react";
import { Icon } from "../../foundations/icon/icon";
import { cn } from "../../utils/tailwind/cn";

/** Texts rendered by `NumberInput`. Pass `lang` to `NumberInput.Root` to override any of them. */
export interface NumberInputLang {
  /** Accessible name of the decrement button. */
  decrement: string;
  /** Accessible name of the increment button. */
  increment: string;
}

/** English defaults for `NumberInputLang`. */
export const defaultNumberInputLang: NumberInputLang = {
  decrement: "Decrease",
  increment: "Increase",
};

interface NumberInputContextValue {
  readonly text: string;
  readonly inputId: string;
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly disabled: boolean;
  readonly value: number | null;
  readonly canDecrement: boolean;
  readonly canIncrement: boolean;
  readonly lang: NumberInputLang;
  readonly setText: (text: string) => void;
  readonly commitText: () => void;
  readonly step: (direction: 1 | -1, multiplier?: number) => void;
  readonly jump: (value: number) => void;
}

const NumberInputContext = React.createContext<NumberInputContextValue | null>(
  null,
);

function useNumberInputContext() {
  const context = React.useContext(NumberInputContext);
  if (!context) {
    throw new Error(
      "NumberInput subcomponents must be used within <NumberInput.Root>.",
    );
  }
  return context;
}

function clamp(
  value: number,
  min: number | undefined,
  max: number | undefined,
) {
  let next = value;
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return next;
}

export interface NumberInputRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "defaultValue" | "lang"> {
  /** Current value, for controlled usage. `null` means empty. */
  value?: number | null;
  /**
   * Initial value, for uncontrolled usage.
   * @default null
   */
  defaultValue?: number | null;
  /** Called with the new value (or `null` when cleared). */
  onValueChange?: (value: number | null) => void;
  /**
   * Smallest allowed value. Typed and stepped values are clamped to it.
   */
  min?: number;
  /**
   * Largest allowed value. Typed and stepped values are clamped to it.
   */
  max?: number;
  /**
   * Amount added or subtracted by the buttons and the arrow keys.
   * @default 1
   */
  step?: number;
  /**
   * Disables the field and both buttons.
   * @default false
   */
  disabled?: boolean;
  /**
   * Texts rendered by the buttons. Merges over English defaults.
   * @default defaultNumberInputLang
   */
  lang?: Partial<NumberInputLang>;
  className?: string;
}

const formatValue = (value: number | null) =>
  value === null ? "" : String(value);

/**
 * Numeric text field with decrement and increment buttons. Typed values are
 * committed on blur or Enter and clamped to `min`/`max`; the arrow keys step
 * by `step` (Shift for ×10, `PageUp`/`PageDown` for ×10 too), and `Home`/`End`
 * jump to the bounds. The field is an ARIA spinbutton.
 * @example
 * ```tsx
 * <NumberInput.Root defaultValue={2} max={10} min={1} onValueChange={setQty}>
 *   <NumberInput.Decrement />
 *   <NumberInput.Field aria-label="Quantity" />
 *   <NumberInput.Increment />
 * </NumberInput.Root>
 * ```
 */
function NumberInputRoot({
  value: controlledValue,
  defaultValue = null,
  onValueChange,
  min,
  max,
  step = 1,
  disabled = false,
  lang,
  className,
  children,
  ...props
}: NumberInputRootProps) {
  const inputId = React.useId();
  const resolvedLang = {
    ...defaultNumberInputLang,
    ...lang,
  };
  const [uncontrolledValue, setUncontrolledValue] =
    React.useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : uncontrolledValue;
  const [text, setTextState] = React.useState(formatValue(value));
  const [editing, setEditing] = React.useState(false);

  const shownText = editing ? text : formatValue(value);

  const emit = React.useCallback(
    (next: number | null) => {
      if (!isControlled) setUncontrolledValue(next);
      onValueChange?.(next);
    },
    [
      isControlled,
      onValueChange,
    ],
  );

  const setText = (next: string) => {
    setEditing(true);
    setTextState(next);
    const parsed = Number(next);
    if (next.trim() !== "" && Number.isFinite(parsed)) emit(parsed);
    if (next.trim() === "") emit(null);
  };

  const commitText = () => {
    const draft = editing ? text : formatValue(value);
    setEditing(false);
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setTextState("");
      emit(null);
      return;
    }
    const clamped = clamp(parsed, min, max);
    setTextState(String(clamped));
    emit(clamped);
  };

  const current = value ?? null;
  const stepBy = (direction: 1 | -1, multiplier = 1) => {
    const base = current ?? clamp(0, min, max);
    const next = clamp(base + direction * step * multiplier, min, max);
    setEditing(false);
    emit(next);
  };

  const jump = (target: number) => {
    setEditing(false);
    emit(clamp(target, min, max));
  };

  const canDecrement =
    !disabled && (current === null || min === undefined || current > min);
  const canIncrement =
    !disabled && (current === null || max === undefined || current < max);

  const contextValue: NumberInputContextValue = {
    canDecrement,
    canIncrement,
    commitText,
    disabled,
    inputId,
    jump,
    lang: resolvedLang,
    max,
    min,
    setText,
    step: stepBy,
    text: shownText,
    value: current,
  };

  return (
    <NumberInputContext.Provider value={contextValue}>
      <div
        aria-disabled={disabled || undefined}
        className={cn(
          "inline-flex h-9 w-fit items-center rounded-md border border-border bg-background font-primary text-sm text-foreground focus-within:border-ring",
          disabled && "opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </NumberInputContext.Provider>
  );
}

export interface NumberInputFieldProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "onChange" | "defaultValue" | "min" | "max" | "step"
  > {}

/** The editable number. An ARIA spinbutton that carries the bounds and current value. */
function NumberInputField({
  className,
  onBlur,
  onKeyDown,
  ...props
}: NumberInputFieldProps) {
  const {
    text,
    inputId,
    min,
    max,
    disabled,
    value,
    setText,
    commitText,
    step,
    jump,
  } = useNumberInputContext();

  return (
    <input
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value ?? undefined}
      autoComplete="off"
      className={cn(
        "h-full w-20 min-w-0 bg-transparent text-center tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
        "focus-visible:outline-none",
        className,
      )}
      disabled={disabled}
      id={inputId}
      inputMode="decimal"
      onBlur={(event) => {
        onBlur?.(event);
        commitText();
      }}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const big = event.shiftKey ? 10 : 1;
        if (event.key === "ArrowUp") {
          event.preventDefault();
          step(1, big);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          step(-1, big);
        } else if (event.key === "PageUp") {
          event.preventDefault();
          step(1, 10);
        } else if (event.key === "PageDown") {
          event.preventDefault();
          step(-1, 10);
        } else if (event.key === "Home" && min !== undefined) {
          event.preventDefault();
          jump(min);
        } else if (event.key === "End" && max !== undefined) {
          event.preventDefault();
          jump(max);
        } else if (event.key === "Enter") {
          commitText();
        }
      }}
      role="spinbutton"
      type="text"
      value={text}
      {...props}
    />
  );
}

export interface NumberInputStepButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {}

const stepButtonClass =
  "flex h-full w-9 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors duration-150 ease-in-out hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

/** Button that subtracts `step` from the value. Disabled at `min`. */
function NumberInputDecrement({
  className,
  onClick,
  ...props
}: NumberInputStepButtonProps) {
  const { canDecrement, step, lang } = useNumberInputContext();

  return (
    <button
      aria-label={lang.decrement}
      className={cn(stepButtonClass, className)}
      disabled={!canDecrement}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) step(-1);
      }}
      type="button"
      {...props}
    >
      <Icon
        aria-hidden="true"
        icon={Minus}
        size="sm"
      />
    </button>
  );
}

/** Button that adds `step` to the value. Disabled at `max`. */
function NumberInputIncrement({
  className,
  onClick,
  ...props
}: NumberInputStepButtonProps) {
  const { canIncrement, step, lang } = useNumberInputContext();

  return (
    <button
      aria-label={lang.increment}
      className={cn(stepButtonClass, className)}
      disabled={!canIncrement}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) step(1);
      }}
      type="button"
      {...props}
    >
      <Icon
        aria-hidden="true"
        icon={Plus}
        size="sm"
      />
    </button>
  );
}

/**
 * Numeric input with decrement and increment buttons, keyboard stepping and
 * `min`/`max` clamping. Compound: `NumberInput.Decrement`, `NumberInput.Field`
 * and `NumberInput.Increment` go inside `NumberInput.Root`.
 */
export const NumberInput = {
  Decrement: NumberInputDecrement,
  Field: NumberInputField,
  Increment: NumberInputIncrement,
  Root: NumberInputRoot,
};
