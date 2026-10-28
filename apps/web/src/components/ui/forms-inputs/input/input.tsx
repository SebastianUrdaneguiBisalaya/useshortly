"use client";

import { Check, Copy, Eye, EyeOff, type LucideIcon } from "lucide-react";
import * as React from "react";
import { Icon } from "../../foundations/icon/icon";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { IconTooltip } from "../../overlays-feedback/tooltip/tooltip";
import { cn } from "../../utils/tailwind/cn";

const inputClassNames = {
  counter: "font-primary text-xs text-muted-foreground",
  field:
    "w-full min-w-0 flex-1 text-sm font-primary bg-transparent outline-none ring-0 border-0 placeholder:text-muted-foreground text-foreground disabled:cursor-not-allowed disabled:opacity-50",
  icon: "flex shrink-0 items-center justify-center text-muted-foreground",
  label: "text-sm font-medium font-primary text-foreground",
  passwordToggle:
    "flex shrink-0 items-center justify-center text-muted-foreground transition-opacity hover:opacity-70 hover:text-foreground",
  root: "flex flex-row items-center gap-2 rounded-md border border-border bg-background px-3 py-2 transition-colors duration-150 ease-in-out has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 focus-within:border-ring",
} as const;

interface InputContextValue {
  inputId: string;
  errorId: string;
  fieldRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  maxLength?: number;
  currentLength: number;
  passwordVisible: boolean;
  togglePasswordVisibility: () => void;
  handleChange: (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
}

const InputContext = React.createContext<InputContextValue | null>(null);

function useInputContext() {
  const context = React.useContext(InputContext);
  if (!context) {
    throw new Error("Input compound components must be used inside <Input>.");
  }
  return context;
}

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.RefObject<T | null>).current = node;
    }
  };
}

export interface InputRootProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Error text shown below the field; also wired to the field via `aria-invalid`/`aria-describedby`. */
  errorMessage?: string;
  /** When set, shows a live character counter (`Input.Counter`) and caps input length. */
  maxLength?: number;
}

/**
 * Compound text field. Accepts an optional `Input.Label`, one `Input.Field`
 * or `Input.Textarea`, optional `Input.Icon`/`Input.PasswordToggle` slots,
 * and renders `Input.Counter`/the error message automatically.
 */
function InputRoot({
  children,
  className,
  errorMessage,
  maxLength,
  ...props
}: InputRootProps) {
  const inputId = React.useId();
  const errorId = `${inputId}-error`;
  const fieldRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(
    null,
  );
  const [currentLength, setCurrentLength] = React.useState(0);
  const [passwordVisible, setPasswordVisible] = React.useState(false);

  const childrenArray = React.Children.toArray(children);
  const label = childrenArray.find(
    (child) => React.isValidElement(child) && child.type === InputLabel,
  );
  const help = childrenArray.find(
    (child) => React.isValidElement(child) && child.type === InputHelp,
  );
  const nonLabel = childrenArray.filter(
    (child) =>
      !(
        React.isValidElement(child) &&
        (child.type === InputLabel || child.type === InputHelp)
      ),
  );

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setCurrentLength(event.target.value.length);
    },
    [],
  );
  const togglePasswordVisibility = React.useCallback(() => {
    setPasswordVisible((visible) => !visible);
  }, []);

  return (
    <InputContext.Provider
      value={{
        currentLength,
        errorId,
        fieldRef,
        handleChange,
        inputId,
        maxLength,
        passwordVisible,
        togglePasswordVisibility,
      }}
    >
      <div className="flex flex-col gap-1.5">
        {(label || help) && (
          <div className="flex flex-row items-center gap-1.5">
            {label}
            {help}
          </div>
        )}
        <div
          className={cn(inputClassNames.root, className)}
          {...props}
        >
          {nonLabel}
        </div>
        {maxLength !== undefined && <Counter />}
        {errorMessage && (
          <p
            className="text-xs text-destructive"
            id={errorId}
            role="alert"
          >
            {errorMessage}
          </p>
        )}
      </div>
    </InputContext.Provider>
  );
}

function InputField({
  className,
  id,
  type,
  onChange,
  ref,
  "aria-invalid": ariaInvalid,
  ...props
}: React.ComponentProps<"input">) {
  const {
    inputId,
    errorId,
    fieldRef,
    handleChange,
    maxLength,
    passwordVisible,
  } = useInputContext();
  const isPasswordField = type === "password";

  const handleFieldChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleChange(event);
    onChange?.(event);
  };

  return (
    <input
      aria-describedby={ariaInvalid ? errorId : undefined}
      aria-invalid={ariaInvalid}
      className={cn(inputClassNames.field, className)}
      id={id ?? inputId}
      maxLength={maxLength}
      onChange={handleFieldChange}
      ref={mergeRefs(fieldRef, ref)}
      type={isPasswordField ? (passwordVisible ? "text" : "password") : type}
      {...props}
    />
  );
}

function InputTextarea({
  className,
  id,
  onChange,
  ref,
  "aria-invalid": ariaInvalid,
  ...props
}: React.ComponentProps<"textarea">) {
  const { inputId, errorId, fieldRef, handleChange, maxLength } =
    useInputContext();

  const handleFieldChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleChange(event);
    onChange?.(event);
  };

  return (
    <textarea
      aria-describedby={ariaInvalid ? errorId : undefined}
      aria-invalid={ariaInvalid}
      className={cn(inputClassNames.field, "resize-none", className)}
      id={id ?? inputId}
      maxLength={maxLength}
      onChange={handleFieldChange}
      ref={mergeRefs(fieldRef, ref)}
      {...props}
    />
  );
}

export interface InputLabelProps
  extends React.HTMLAttributes<HTMLLabelElement> {
  /** Appends a required-field indicator (`*`) after the label text. */
  required?: boolean;
}

function InputLabel({
  children,
  className,
  required,
  ...props
}: InputLabelProps) {
  const { inputId } = useInputContext();
  return (
    <label
      {...props}
      className={cn(inputClassNames.label, className)}
      htmlFor={inputId}
    >
      {children}
      {required && (
        <span
          aria-hidden="true"
          className="text-destructive"
        >
          {" "}
          *
        </span>
      )}
    </label>
  );
}

export interface InputHelpProps {
  /** Help text shown in a tooltip when the user hovers, focuses or clicks the help icon. Ignored when `children` is provided. */
  description?: string;
  /** Custom help trigger/content, e.g. a `Popover` for rich content. Replaces the default `IconTooltip`. */
  children?: React.ReactNode;
  /**
   * Accessible name of the default help button.
   * @default "Show description"
   */
  "aria-label"?: string;
}

/**
 * Optional help hint rendered next to `Input.Label`. By default it renders an `IconTooltip` with `description`;
 * pass `children` (for example a `Popover`) for richer content.
 */
function InputHelp({
  children,
  description,
  "aria-label": ariaLabel,
}: InputHelpProps) {
  if (children) return <>{children}</>;
  if (!description) return null;
  return (
    <IconTooltip
      aria-label={ariaLabel}
      description={description}
    />
  );
}

export interface InputIconProps {
  /** Lucide icon component to render. */
  icon: LucideIcon;
  className?: string;
  /** Accessible name; omit for a purely decorative icon. */
  "aria-label"?: string;
}

function InputIcon({
  icon,
  className,
  "aria-label": ariaLabel,
}: InputIconProps) {
  return (
    <span className={cn(inputClassNames.icon, className)}>
      <Icon
        aria-hidden={!ariaLabel}
        aria-label={ariaLabel}
        icon={icon}
        size="sm"
      />
    </span>
  );
}

export interface InputPasswordToggleProps {
  /**
   * Accessible name/tooltip while the password is visible.
   * @default "Hide password"
   */
  hideLabel?: string;
  /**
   * Accessible name/tooltip while the password is hidden.
   * @default "Show password"
   */
  showLabel?: string;
  className?: string;
}

/** Toggles the sibling `Input.Field type="password"` between masked and visible. */
function InputPasswordToggle({
  hideLabel = "Hide password",
  showLabel = "Show password",
  className,
}: InputPasswordToggleProps) {
  const { passwordVisible, togglePasswordVisibility } = useInputContext();

  return (
    <button
      aria-label={passwordVisible ? hideLabel : showLabel}
      aria-pressed={passwordVisible}
      className={cn(
        inputClassNames.passwordToggle,
        "cursor-pointer rounded-sm focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
        className,
      )}
      onClick={togglePasswordVisibility}
      type="button"
    >
      <span
        className="flex animate-fade-scale-in"
        key={passwordVisible ? "visible" : "hidden"}
      >
        <Icon
          icon={passwordVisible ? EyeOff : Eye}
          size="sm"
        />
      </span>
    </button>
  );
}

/** Texts rendered by `Input.CopyButton`. Pass `lang` to override any of them. */
export interface InputCopyButtonLang {
  /** Accessible label before copying. */
  copy: string;
  /** Accessible label right after copying. */
  copied: string;
}

/** English defaults for `InputCopyButtonLang`. */
export const defaultInputCopyButtonLang: InputCopyButtonLang = {
  copied: "Copied",
  copy: "Copy",
};

export interface InputCopyButtonProps {
  /**
   * Text to copy. When omitted, the current value of the sibling `Input.Field` / `Input.Textarea` is copied.
   */
  value?: string;
  /**
   * Texts rendered by this component. Merges over English defaults.
   * @default defaultInputCopyButtonLang
   */
  lang?: Partial<InputCopyButtonLang>;
  /** Additional classes for the button. */
  className?: string;
}

/**
 * Copies the field's value to the clipboard and briefly swaps the icon for a check. Pair it with
 * `Input.Field readOnly` to show a value the user can copy but not edit. For a secret such as an API token, use
 * `type="password"` and omit `Input.PasswordToggle`: the value stays masked and is still copied in full.
 */
function InputCopyButton({ className, lang, value }: InputCopyButtonProps) {
  const resolvedLang = {
    ...defaultInputCopyButtonLang,
    ...lang,
  };
  const { fieldRef } = useInputContext();
  const { copied, copy } = useCopyToClipboard();

  return (
    <>
      <button
        aria-label={copied ? resolvedLang.copied : resolvedLang.copy}
        className={cn(
          inputClassNames.passwordToggle,
          "cursor-pointer rounded-sm focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
          className,
        )}
        onClick={() => copy(value ?? fieldRef.current?.value ?? "")}
        type="button"
      >
        <span
          className="flex animate-fade-scale-in"
          key={copied ? "copied" : "copy"}
        >
          <Icon
            icon={copied ? Check : Copy}
            size="sm"
          />
        </span>
      </button>
      <span
        className="sr-only"
        role="status"
      >
        {copied ? resolvedLang.copied : ""}
      </span>
    </>
  );
}

function Counter() {
  const { maxLength, currentLength } = useInputContext();
  if (maxLength === undefined) return null;

  const remaining = maxLength - currentLength;
  const nearLimit = remaining <= 10 && remaining >= 0;
  const exceeded = remaining < 0;

  return (
    <div className="flex w-full flex-col items-end">
      <span
        className={cn(
          inputClassNames.counter,
          nearLimit && "text-warning",
          exceeded && "text-destructive",
        )}
      >
        {currentLength}/{maxLength} caracteres
      </span>
    </div>
  );
}

/**
 * Compound text field.
 * @example
 * ```tsx
 * <Input>
 *   <Input.Label>Password</Input.Label>
 *   <Input.Field type="password" />
 *   <Input.PasswordToggle />
 * </Input>
 * ```
 */
export const Input = Object.assign(InputRoot, {
  CopyButton: InputCopyButton,
  Counter,
  Field: InputField,
  Help: InputHelp,
  Icon: InputIcon,
  Label: InputLabel,
  PasswordToggle: InputPasswordToggle,
  Textarea: InputTextarea,
});
