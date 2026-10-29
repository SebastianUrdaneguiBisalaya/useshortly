'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { Icon } from '../../foundations/icon/icon';
import { cn } from '../../utils/tailwind/cn';

/**
 * Per-variant text/icon color. Every variant resolves to a semantic token
 * (never a raw color), so switching the `data-theme` attribute or the OS
 * color scheme re-colors every button automatically — no `dark`/`light`
 * variant is needed on the component itself.
 */
const variantForeground = {
	destructive: 'text-destructive-foreground',
	ghost: 'text-foreground',
	primary: 'text-background',
	secondary: 'text-foreground',
} as const;

export const buttonVariants = {
	icon: cva('flex shrink-0 items-center justify-center', {
		defaultVariants: {
			variant: 'primary',
		},
		variants: {
			variant: variantForeground,
		},
	}),
	root: cva('flex w-fit group flex-row items-center justify-center gap-2 rounded-lg transition-opacity duration-300 ease-in-out cursor-pointer', {
		defaultVariants: {
			size: 'md',
			variant: 'primary',
		},
		variants: {
			size: {
				icon: 'p-2 aspect-square',
				md: 'px-4 py-2',
			},
			variant: {
				destructive: 'bg-destructive hover:bg-destructive-hover',
				ghost: 'bg-transparent hover:bg-muted',
				primary: 'bg-foreground',
				secondary: 'bg-background border border-border hover:bg-muted',
			},
		},
	}),

	spinner: cva('size-4 animate-spin', {
		defaultVariants: {
			variant: 'primary',
		},
		variants: {
			variant: variantForeground,
		},
	}),

	text: cva('font-primary text-sm font-medium leading-none', {
		defaultVariants: {
			variant: 'primary',
		},
		variants: {
			variant: variantForeground,
		},
	}),
};

export type ButtonVariantProps = VariantProps<typeof buttonVariants.root>['variant'];
export type ButtonSizeProps = VariantProps<typeof buttonVariants.root>['size'];

/** Texts rendered by `Button`. Pass `lang` to override any of them. */
export interface ButtonLang {
	/** Text shown next to the spinner while `loading` is `true`. */
	loadingText: string;
}

/** English defaults for `ButtonLang`. */
export const defaultButtonLang: ButtonLang = {
	loadingText: 'Loading...',
};

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'lang'> {
	/**
	 * Visual style of the button.
	 * @default "primary"
	 */
	variant?: ButtonVariantProps;
	/**
	 * Size of the button. `"icon"` renders a square, icon-only button.
	 * @default "md"
	 */
	size?: ButtonSizeProps;
	/** Shows the loading spinner and disables the button while `true`. */
	loading?: boolean;
	/**
	 * Texts rendered by this button. Merges over English defaults.
	 * @default defaultButtonLang
	 */
	lang?: Partial<ButtonLang>;
}

export interface ButtonTextProps extends React.HTMLAttributes<HTMLSpanElement> {}

export interface ButtonIconProps extends React.HTMLAttributes<HTMLSpanElement> {
	/** Lucide icon component to render. */
	icon: LucideIcon | React.ReactElement;
	/** Accessible name for the icon. Required when the icon conveys meaning on its own (e.g. an icon-only button). */
	'aria-label'?: string;
	/** Additional classes applied to the icon's wrapping `span`. */
	className?: string;
}

interface ButtonContextValue {
	variant: ButtonVariantProps;
}

const ButtonContext = React.createContext<ButtonContextValue | null>(null);

function useButtonContext() {
	const context = React.useContext(ButtonContext);

	if (!context) {
		throw new Error('Button compound components must be used inside <Button>.');
	}

	return context;
}

function ButtonSpinner() {
	const { variant } = useButtonContext();

	return (
		<LoaderCircle
			aria-hidden='true'
			className={buttonVariants.spinner({
				variant,
			})}
		/>
	);
}

/** Root button element. Renders a spinner and `lang.loadingText` in place of `children` while `loading`. */
function ButtonRoot({ children, className, variant = 'primary', size = 'md', type = 'button', disabled = false, loading = false, lang, ...props }: ButtonProps) {
	const isDisabled = disabled || loading;
	const resolvedLang = { ...defaultButtonLang, ...lang };

	return (
		<ButtonContext.Provider
			value={{
				variant,
			}}
		>
			<button
				{...props}
				aria-busy={loading}
				className={cn(
					buttonVariants.root({
						size,
						variant,
					}),
					'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
					className,
					isDisabled ? 'cursor-not-allowed opacity-80' : 'hover:opacity-90'
				)}
				disabled={isDisabled}
				type={type}
			>
				{loading ? (
					<>
						<ButtonSpinner />

						<ButtonText>{resolvedLang.loadingText}</ButtonText>
					</>
				) : (
					children
				)}
			</button>
		</ButtonContext.Provider>
	);
}

/** Label text for a `Button`. Inherits the button's variant color/typography. */
function ButtonText({ children, className, ...props }: ButtonTextProps) {
	const { variant } = useButtonContext();

	return (
		<span
			{...props}
			className={cn(
				buttonVariants.text({
					variant,
				}),
				className
			)}
		>
			{children}
		</span>
	);
}

/** Icon slot for a `Button`. Pass `aria-label` when the icon is the button's only content. */
function ButtonIcon({ icon, 'aria-label': ariaLabel, className, ...props }: ButtonIconProps) {
	const { variant } = useButtonContext();

	return (
		<span
			{...props}
			className={cn(
				buttonVariants.icon({
					variant,
				}),
				className
			)}
		>
			{React.isValidElement(icon) ? icon : <Icon aria-hidden={!ariaLabel} aria-label={ariaLabel} icon={icon} size='sm' />}
		</span>
	);
}

/**
 * Compound button component.
 * @example
 * ```tsx
 * <Button variant="primary" size="md">
 *   <Button.Icon icon={Plus} />
 *   <Button.Text>Add item</Button.Text>
 * </Button>
 * ```
 */
export const Button = Object.assign(ButtonRoot, {
	Icon: ButtonIcon,
	Text: ButtonText,
});
