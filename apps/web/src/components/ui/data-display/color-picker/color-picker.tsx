"use client";

import { Pipette } from "lucide-react";
import * as React from "react";
import { HexColorPicker } from "react-colorful";
import { Input } from "../../forms-inputs/input/input";
import { Icon } from "../../foundations/icon/icon";
import { Popover } from "../../overlays-feedback/popover/popover";
import { cn } from "../../utils/tailwind/cn";

// Not yet in TypeScript's DOM lib: https://wicg.github.io/eyedropper-api/
interface EyeDropperResult {
  readonly sRGBHex: string;
}
interface EyeDropperInstance {
  open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult>;
}
declare global {
  interface Window {
    EyeDropper?: new () => EyeDropperInstance;
  }
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalizes `#abc`/`#aabbcc` (any case) to a canonical lowercase `#aabbcc`, or returns `null` if `hex` isn't a valid 3- or 6-digit hex color. */
function normalizeHex(hex: string): string | null {
  const trimmed = hex.trim();
  if (!HEX_PATTERN.test(trimmed)) return null;
  const digits = trimmed.slice(1).toLowerCase();
  const expanded =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return `#${expanded}`;
}

type ColorPickerContextValue = {
  /** Canonical, always-valid lowercase 6-digit hex, e.g. `#3b82f6`. */
  readonly value: string;
  readonly setValue: (hex: string) => void;
};

const ColorPickerContext = React.createContext<ColorPickerContextValue | null>(
  null,
);

function useColorPickerContext(): ColorPickerContextValue {
  const context = React.useContext(ColorPickerContext);
  if (!context) {
    throw new Error(
      "ColorPicker compound components must be used inside <ColorPicker>.",
    );
  }
  return context;
}

const DEFAULT_COLOR = "#000000";

export interface ColorPickerRootProps {
  /** Initial color as a 3- or 6-digit hex string (uncontrolled usage). @default "#000000" */
  readonly defaultValue?: string;
  /** Color as a 3- or 6-digit hex string (controlled usage). */
  readonly value?: string;
  readonly children: React.ReactNode;
  /** Called with the canonical 6-digit lowercase hex whenever the color changes, from the gradient, the hex field, or the eyedropper. */
  readonly onValueChange?: (hex: string) => void;
}

/**
 * Compound color picker. A trigger swatch (`ColorPicker.Trigger`) opens a
 * popover (`ColorPicker.Content`) where the color can be set by dragging the
 * saturation/hue gradient (`ColorPicker.Gradient`), typing a hex value
 * (`ColorPicker.HexField`), or sampling any pixel on the screen
 * (`ColorPicker.EyeDropper`, where the browser supports it).
 * @example
 * ```tsx
 * <ColorPicker defaultValue="#3b82f6" onValueChange={setColor}>
 *   <ColorPicker.Trigger />
 *   <ColorPicker.Content>
 *     <ColorPicker.Gradient />
 *     <div className="flex items-center gap-2">
 *       <ColorPicker.HexField />
 *       <ColorPicker.EyeDropper />
 *     </div>
 *   </ColorPicker.Content>
 * </ColorPicker>
 * ```
 */
function ColorPickerRoot({
  defaultValue = DEFAULT_COLOR,
  value: controlledValue,
  children,
  onValueChange,
}: ColorPickerRootProps) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(
    () => normalizeHex(defaultValue) ?? DEFAULT_COLOR,
  );
  const normalizedControlledValue =
    controlledValue !== undefined ? normalizeHex(controlledValue) : undefined;
  const value = normalizedControlledValue ?? uncontrolledValue ?? DEFAULT_COLOR;

  const setValue = React.useCallback(
    (hex: string) => {
      const normalized = normalizeHex(hex);
      if (!normalized) return;
      if (controlledValue === undefined) setUncontrolledValue(normalized);
      onValueChange?.(normalized);
    },
    [
      controlledValue,
      onValueChange,
    ],
  );

  const contextValue = React.useMemo(
    () => ({
      setValue,
      value,
    }),
    [
      value,
      setValue,
    ],
  );

  return (
    <ColorPickerContext.Provider value={contextValue}>
      <Popover>{children}</Popover>
    </ColorPickerContext.Provider>
  );
}

export interface ColorPickerTriggerProps {
  readonly className?: string;
  /** Accessible name; the current hex value is already visible as text, so this only needs to add context (e.g. "Brand color"). @default "Choose a color" */
  readonly "aria-label"?: string;
}

/** Swatch button that shows the current color and opens `ColorPicker.Content`. */
function ColorPickerTrigger({
  className,
  "aria-label": ariaLabel = "Choose a color",
}: ColorPickerTriggerProps) {
  const { value } = useColorPickerContext();

  return (
    <Popover.Trigger>
      <button
        aria-label={ariaLabel}
        className={cn(
          "flex h-9 w-fit cursor-pointer flex-row items-center gap-2 rounded-md border border-border bg-background px-3 py-2 transition-colors duration-150 ease-in-out hover:bg-muted",
          "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
          className,
        )}
        type="button"
      >
        <span
          aria-hidden="true"
          className="size-4 shrink-0 rounded-sm border border-border"
          style={{
            backgroundColor: value,
          }}
        />
        <span className="font-secondary text-foreground text-sm uppercase">
          {value}
        </span>
      </button>
    </Popover.Trigger>
  );
}

export interface ColorPickerContentProps {
  readonly children: React.ReactNode;
  /**
   * Accessible label of the popover panel.
   * @default "Color picker"
   */
  readonly "aria-label"?: string;
  readonly className?: string;
}

/** Positioned popover panel holding the picker's controls. */
function ColorPickerContent({
  children,
  "aria-label": ariaLabel = "Color picker",
  className,
}: ColorPickerContentProps) {
  return (
    <Popover.Content
      aria-label={ariaLabel}
      className={cn("flex w-56 flex-col gap-3", className)}
    >
      {children}
    </Popover.Content>
  );
}

export interface ColorPickerGradientProps {
  readonly className?: string;
}

/** Saturation/hue gradient for picking a color visually, via `react-colorful`. */
function ColorPickerGradient({ className }: ColorPickerGradientProps) {
  const { value, setValue } = useColorPickerContext();

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border [&_.react-colorful]:w-full",
        className,
      )}
    >
      <HexColorPicker
        color={value}
        onChange={setValue}
      />
    </div>
  );
}

export interface ColorPickerHexFieldProps {
  readonly className?: string;
  /** Accessible name for the field. @default "Hex color value" */
  readonly "aria-label"?: string;
}

/** Text field for typing a hex value directly. Reverts to the last valid color if it loses focus while invalid. */
function ColorPickerHexField({
  className,
  "aria-label": ariaLabel = "Hex color value",
}: ColorPickerHexFieldProps) {
  const { value, setValue } = useColorPickerContext();
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    setDraft(value);
  }, [
    value,
  ]);

  const commit = () => {
    const normalized = normalizeHex(
      draft.startsWith("#") ? draft : `#${draft}`,
    );
    setDraft(normalized ?? value);
    if (normalized) setValue(normalized);
  };

  return (
    <Input className={cn("flex-1", className)}>
      <span
        aria-hidden="true"
        className="font-secondary text-muted-foreground text-sm"
      >
        #
      </span>
      <Input.Field
        aria-label={ariaLabel}
        className="font-secondary uppercase"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value.replace("#", ""))}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
        value={draft.replace("#", "")}
      />
    </Input>
  );
}

export interface ColorPickerEyeDropperProps {
  readonly className?: string;
  /** Accessible name for the control. @default "Pick color from screen" */
  readonly "aria-label"?: string;
}

/**
 * Samples any pixel on the screen with the native EyeDropper API and sets it
 * as the color. Renders nothing in browsers that don't implement the API
 * (currently Chromium-based browsers only).
 */
function ColorPickerEyeDropper({
  className,
  "aria-label": ariaLabel = "Pick color from screen",
}: ColorPickerEyeDropperProps) {
  const { setValue } = useColorPickerContext();
  const supported =
    typeof window !== "undefined" && window.EyeDropper !== undefined;

  if (!supported) return null;

  const handleClick = async () => {
    const EyeDropperCtor = window.EyeDropper;
    if (!EyeDropperCtor) return;
    try {
      const result = await new EyeDropperCtor().open();
      setValue(result.sRGBHex);
    } catch {
      // User cancelled the pick (e.g. pressed Escape) — nothing to do.
    }
  };

  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors duration-150 ease-in-out hover:bg-muted hover:text-foreground",
        "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
        className,
      )}
      onClick={handleClick}
      type="button"
    >
      <Icon
        aria-hidden
        icon={Pipette}
        size="sm"
      />
    </button>
  );
}

/**
 * Compound color picker (see `ColorPickerRoot`).
 */
export const ColorPicker = Object.assign(ColorPickerRoot, {
  Content: ColorPickerContent,
  EyeDropper: ColorPickerEyeDropper,
  Gradient: ColorPickerGradient,
  HexField: ColorPickerHexField,
  Trigger: ColorPickerTrigger,
});
