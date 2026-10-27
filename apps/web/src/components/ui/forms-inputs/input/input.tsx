'use client';

import { Eye, EyeOff, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { Icon } from '../../foundations/icon/icon';
import { cn } from '../../utils/tailwind/cn';

const inputClassNames = {
	counter: 'font-primary text-xs text-muted-foreground',
	field: 'w-full min-w-0 flex-1 text-sm font-primary bg-transparent outline-none ring-0 border-0 placeholder:text-muted-foreground text-foreground disabled:cursor-not-allowed disabled:opacity-50',
	icon: 'flex shrink-0 items-center justify-center text-muted-foreground',
	label: 'text-sm font-medium font-primary text-foreground',
	passwordToggle: 'flex shrink-0 items-center justify-center text-muted-foreground transition-opacity hover:opacity-70 hover:text-foreground',
	root: 'flex flex-row items-center gap-2 rounded-md border border-border bg-background px-3 py-2 transition-colors duration-150 ease-in-out has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 focus-within:border-ring',
} as const;

interface InputContextValue {
	inputId: string;
	errorId: string;
	maxLength?: number;
	currentLength: number;
	passwordVisible: boolean;
	togglePasswordVisibility: () => void;
	handleChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

const InputContext = React.createContext<InputContextValue | null>(null);

function useInputContext() {
	const context = React.useContext(InputContext);
	if (!context) {
		throw new Error('Input compound components must be used inside <Input>.');
	}
	return context;
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
function InputRoot({ children, className, errorMessage, maxLength, ...props }: InputRootProps) {
	const inputId = React.useId();
	const errorId = `${inputId}-error`;
	const [currentLength, setCurrentLength] = React.useState(0);
	const [passwordVisible, setPasswordVisible] = React.useState(false);

	const childrenArray = React.Children.toArray(children);
	const label = childrenArray.find(child => React.isValidElement(child) && child.type === InputLabel);
	const nonLabel = childrenArray.filter(child => !(React.isValidElement(child) && child.type === InputLabel));

	const handleChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		setCurrentLength(event.target.value.length);
	}, []);
	const togglePasswordVisibility = React.useCallback(() => {
		setPasswordVisible(visible => !visible);
	}, []);

	return (
		<InputContext.Provider
			value={{
				currentLength,
				errorId,
				handleChange,
				inputId,
				maxLength,
				passwordVisible,
				togglePasswordVisibility,
			}}
		>
			<div className='flex flex-col gap-1.5'>
				{label}
				<div className={cn(inputClassNames.root, className)} {...props}>
					{nonLabel}
				</div>
				{maxLength !== undefined && <Counter />}
				{errorMessage && (
					<p className='text-xs text-destructive' id={errorId} role='alert'>
						{errorMessage}
					</p>
				)}
			</div>
		</InputContext.Provider>
	);
}

function InputField({ className, id, type, onChange, 'aria-invalid': ariaInvalid, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
	const { inputId, errorId, handleChange, maxLength, passwordVisible } = useInputContext();
	const isPasswordField = type === 'password';

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
			type={isPasswordField ? (passwordVisible ? 'text' : 'password') : type}
			{...props}
		/>
	);
}

function InputTextarea({ className, id, onChange, 'aria-invalid': ariaInvalid, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
	const { inputId, errorId, handleChange, maxLength } = useInputContext();

	const handleFieldChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
		handleChange(event);
		onChange?.(event);
	};

	return (
		<textarea
			aria-describedby={ariaInvalid ? errorId : undefined}
			aria-invalid={ariaInvalid}
			className={cn(inputClassNames.field, 'resize-none', className)}
			id={id ?? inputId}
			maxLength={maxLength}
			onChange={handleFieldChange}
			{...props}
		/>
	);
}

export interface InputLabelProps extends React.HTMLAttributes<HTMLLabelElement> {
	/** Appends a required-field indicator (`*`) after the label text. */
	required?: boolean;
}

function InputLabel({ children, className, required, ...props }: InputLabelProps) {
	const { inputId } = useInputContext();
	return (
		<label {...props} className={cn(inputClassNames.label, className)} htmlFor={inputId}>
			{children}
			{required && (
				<span aria-hidden='true' className='text-destructive'>
					{' '}
					*
				</span>
			)}
		</label>
	);
}

export interface InputIconProps {
	/** Lucide icon component to render. */
	icon: LucideIcon;
	className?: string;
	/** Accessible name; omit for a purely decorative icon. */
	'aria-label'?: string;
}

function InputIcon({ icon, className, 'aria-label': ariaLabel }: InputIconProps) {
	return (
		<span className={cn(inputClassNames.icon, className)}>
			<Icon aria-hidden={!ariaLabel} aria-label={ariaLabel} icon={icon} size='sm' />
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
function InputPasswordToggle({ hideLabel = 'Hide password', showLabel = 'Show password', className }: InputPasswordToggleProps) {
	const { passwordVisible, togglePasswordVisibility } = useInputContext();

	return (
		<button
			aria-label={passwordVisible ? hideLabel : showLabel}
			aria-pressed={passwordVisible}
			className={cn(inputClassNames.passwordToggle, 'cursor-pointer rounded-sm focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!', className)}
			onClick={togglePasswordVisibility}
			type='button'
		>
			<span className='flex animate-fade-scale-in' key={passwordVisible ? 'visible' : 'hidden'}>
				<Icon icon={passwordVisible ? EyeOff : Eye} size='sm' />
			</span>
		</button>
	);
}

function Counter() {
	const { maxLength, currentLength } = useInputContext();
	if (maxLength === undefined) return null;

	const remaining = maxLength - currentLength;
	const nearLimit = remaining <= 10 && remaining >= 0;
	const exceeded = remaining < 0;

	return (
		<div className='flex w-full flex-col items-end'>
			<span className={cn(inputClassNames.counter, nearLimit && 'text-warning', exceeded && 'text-destructive')}>
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
	Counter,
	Field: InputField,
	Icon: InputIcon,
	Label: InputLabel,
	PasswordToggle: InputPasswordToggle,
	Textarea: InputTextarea,
});
