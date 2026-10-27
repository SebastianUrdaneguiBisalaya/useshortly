"use client";

import * as React from "react";

import { cn } from "../../utils/tailwind/cn";

export interface RadioGroupContextValue {
  readonly name: string;
  readonly value: string | null;
  readonly setValue: (value: string) => void;
  readonly disabled?: boolean;
  /** Id of the first mounted `RadioGroup.Item`, so exactly one radio stays in the tab sequence when nothing is selected yet. */
  readonly firstItemId: string | null;
  readonly registerItem: (id: string) => void;
}

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(
  null,
);

/** Exported so other components (e.g. `ChoiceBlock`) can build their own `role="radio"` item on top of `RadioGroup`'s roving-tabindex/keyboard engine instead of reimplementing it — see `focusRadioAt`, its arrow-key-navigation counterpart. */
export function useRadioGroupContext() {
  const context = React.useContext(RadioGroupContext);
  if (!context) {
    throw new Error("RadioGroup.Item must be used within <RadioGroup>.");
  }
  return context;
}

interface RadioItemContextValue {
  readonly id: string;
}

const RadioItemContext = React.createContext<RadioItemContextValue | null>(
  null,
);

function useRadioItemContext() {
  const context = React.useContext(RadioItemContext);
  if (!context) {
    throw new Error(
      "RadioGroup.ItemLabel must be used within <RadioGroup.Item>.",
    );
  }
  return context;
}

export interface RadioGroupProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Selected value, for controlled usage. */
  value?: string;
  /** Initial selected value, for uncontrolled usage. */
  defaultValue?: string;
  /** Called with the newly selected value. */
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}

/** Moves focus to the `[role="radio"]` at `index` (wrapping) within `group`, and returns its `value` — shared with `ChoiceBlock.Item`'s own arrow-key handling. */
export function focusRadioAt(group: HTMLElement, index: number) {
  const radios = Array.from(
    group.querySelectorAll<HTMLElement>('[role="radio"]'),
  );
  const count = radios.length;
  if (count === 0) return;
  const target = radios[((index % count) + count) % count];
  target.focus();
  return target.dataset.value;
}

/**
 * Compound radio group, following the WAI-ARIA Radio Group pattern (roving
 * tabindex, arrow-key navigation, automatic selection on move).
 * @example
 * ```tsx
 * <RadioGroup aria-label="Plan" defaultValue="pro" onValueChange={setPlan}>
 *   <RadioGroup.Item value="free"><RadioGroup.ItemLabel>Free</RadioGroup.ItemLabel></RadioGroup.Item>
 *   <RadioGroup.Item value="pro"><RadioGroup.ItemLabel>Pro</RadioGroup.ItemLabel></RadioGroup.Item>
 * </RadioGroup>
 * ```
 */
function RadioGroupRoot({
  value: controlledValue,
  defaultValue,
  onValueChange,
  disabled,
  className,
  children,
  ...props
}: RadioGroupProps) {
  const name = React.useId();
  const [uncontrolledValue, setUncontrolledValue] = React.useState<
    string | null
  >(defaultValue ?? null);
  const [firstItemId, setFirstItemId] = React.useState<string | null>(null);
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? (controlledValue ?? null) : uncontrolledValue;

  const setValue = React.useCallback(
    (next: string) => {
      if (!isControlled) setUncontrolledValue(next);
      onValueChange?.(next);
    },
    [
      isControlled,
      onValueChange,
    ],
  );
  const registerItem = React.useCallback((id: string) => {
    setFirstItemId((prev) => prev ?? id);
  }, []);

  const contextValue = React.useMemo(
    () => ({
      disabled,
      firstItemId,
      name,
      registerItem,
      setValue,
      value,
    }),
    [
      disabled,
      firstItemId,
      name,
      registerItem,
      setValue,
      value,
    ],
  );

  return (
    <RadioGroupContext.Provider value={contextValue}>
      <div
        className={cn("flex flex-col gap-2", className)}
        role="radiogroup"
        {...props}
      >
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

export interface RadioGroupItemProps {
  /** Value this item selects when chosen; must be unique within the group. */
  value: string;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

/** One selectable option. Wraps the radio control and an optional `RadioGroup.ItemLabel`. */
function RadioGroupItem({
  value,
  disabled,
  children,
  className,
}: RadioGroupItemProps) {
  const {
    name,
    value: groupValue,
    setValue,
    disabled: groupDisabled,
    firstItemId,
    registerItem,
  } = useRadioGroupContext();
  const id = `${name}-${value}`;
  const checked = groupValue === value;
  const itemDisabled = disabled ?? groupDisabled;

  React.useEffect(() => {
    registerItem(id);
  }, [
    id,
    registerItem,
  ]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const group = event.currentTarget.closest('[role="radiogroup"]');
    if (!(group instanceof HTMLElement)) return;

    const radios = Array.from(
      group.querySelectorAll<HTMLElement>('[role="radio"]'),
    );
    const index = radios.indexOf(event.currentTarget);
    if (index === -1) return;

    let nextValue: string | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextValue = focusRadioAt(group, index + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextValue = focusRadioAt(group, index - 1);
    }

    if (nextValue !== undefined) {
      event.preventDefault();
      setValue(nextValue);
    }
  };

  return (
    <RadioItemContext.Provider
      value={{
        id,
      }}
    >
      <div className={cn("flex items-center gap-2", className)}>
        <button
          aria-checked={checked}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150 ease-in-out",
            "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
            "disabled:cursor-not-allowed disabled:opacity-50",
            checked ? "border-foreground" : "border-border",
            !itemDisabled && "cursor-pointer",
          )}
          data-state={checked ? "checked" : "unchecked"}
          data-value={value}
          disabled={itemDisabled}
          id={id}
          onClick={() => setValue(value)}
          onKeyDown={handleKeyDown}
          role="radio"
          tabIndex={
            checked || (groupValue === null && id === firstItemId) ? 0 : -1
          }
          type="button"
        >
          {checked && <span className="size-2 rounded-full bg-foreground" />}
        </button>
        {children}
      </div>
    </RadioItemContext.Provider>
  );
}

export interface RadioGroupItemLabelProps {
  children: React.ReactNode;
  className?: string;
}

/** Label for the `RadioGroup.Item` inside the same item. */
function RadioGroupItemLabel({
  children,
  className,
}: RadioGroupItemLabelProps) {
  const { id } = useRadioItemContext();
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

export const RadioGroup = Object.assign(RadioGroupRoot, {
  Item: RadioGroupItem,
  ItemLabel: RadioGroupItemLabel,
});
