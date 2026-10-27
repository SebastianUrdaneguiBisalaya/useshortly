'use client';

import { CircleCheck, Info, type LucideIcon, OctagonAlert, TriangleAlert, X } from 'lucide-react';
import * as React from 'react';
import { Icon } from '../../foundations/icon/icon';
import { cn } from '../../utils/tailwind/cn';

/** Semantic tone of an `Alert`. */
export type AlertVariant = 'default' | 'destructive' | 'success' | 'warning';

const toneClassName: Record<AlertVariant, string> = {
	default: 'border-border bg-background',
	destructive: 'border-destructive/30 bg-destructive/5',
	success: 'border-success/30 bg-success/5',
	warning: 'border-warning/30 bg-warning/5',
};

const iconToneClassName: Record<AlertVariant, string> = {
	default: 'text-foreground',
	destructive: 'text-destructive',
	success: 'text-success',
	warning: 'text-warning',
};

const defaultIcon: Record<AlertVariant, LucideIcon> = {
	default: Info,
	destructive: OctagonAlert,
	success: CircleCheck,
	warning: TriangleAlert,
};

interface AlertContextValue {
	readonly variant: AlertVariant;
	readonly onDismiss: () => void;
}

const AlertContext = React.createContext<AlertContextValue | null>(null);

function useAlertContext() {
	const context = React.useContext(AlertContext);
	if (!context) {
		throw new Error('Alert subcomponents must be used within <Alert>.');
	}
	return context;
}

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'role'> {
	/**
	 * Semantic tone. State color stays on the icon and a faint wash; the text
	 * stays neutral ink.
	 * @default "default"
	 */
	variant?: AlertVariant;
	/**
	 * ARIA role. Defaults to `"alert"` (assertive) for `destructive` and
	 * `"status"` (polite) otherwise — override it for content that is present
	 * on first render and shouldn't be announced.
	 */
	role?: 'alert' | 'status' | 'none';
	/** Visibility, for controlled usage. */
	open?: boolean;
	/** Initial visibility, for uncontrolled usage. @default true */
	defaultOpen?: boolean;
	/** Called whenever visibility changes, controlled or not (e.g. via `Alert.Close`). */
	onOpenChange?: (open: boolean) => void;
}

/**
 * Compound inline alert — a persistent, in-flow message about the state of
 * what's on the page (a failed save, a plan limit, a successful import). Not
 * an overlay (`Modal`), a transient notice (`Notifications`), or an
 * edge-to-edge announcement (`Banner`). Lay it out with `Alert.Icon`,
 * `Alert.Title`, `Alert.Description`, and optionally `Alert.Action` and
 * `Alert.Close`.
 * @example
 * ```tsx
 * <Alert variant="warning">
 *   <Alert.Icon />
 *   <Alert.Title>Storage almost full</Alert.Title>
 *   <Alert.Description>You've used 92% of your plan. Upgrade to keep uploading.</Alert.Description>
 *   <Alert.Action><Button variant="secondary"><Button.Text>Upgrade</Button.Text></Button></Alert.Action>
 *   <Alert.Close />
 * </Alert>
 * ```
 */
function AlertRoot({ variant = 'default', role, open: controlledOpen, defaultOpen = true, onOpenChange, className, children, ...props }: AlertProps) {
	const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
	const isControlled = controlledOpen !== undefined;
	const open = isControlled ? controlledOpen : internalOpen;

	const onDismiss = React.useCallback(() => {
		if (!isControlled) setInternalOpen(false);
		onOpenChange?.(false);
	}, [isControlled, onOpenChange]);

	const value = React.useMemo<AlertContextValue>(
		() => ({
			onDismiss,
			variant,
		}),
		[onDismiss, variant]
	);

	if (!open) return null;

	return (
		<AlertContext.Provider value={value}>
			<div
				className={cn(
					'relative grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-1 rounded-lg border p-4 font-primary text-sm text-foreground',
					toneClassName[variant],
					className
				)}
				role={role === 'none' ? undefined : (role ?? (variant === 'destructive' ? 'alert' : 'status'))}
				{...props}
			>
				{children}
			</div>
		</AlertContext.Provider>
	);
}

export interface AlertIconProps {
	/** Icon to show. Defaults to a glyph matching `variant`, so state never rides on color alone. */
	icon?: LucideIcon;
	/** Additional classes for the icon. */
	className?: string;
}

/** Leading icon, tinted with the alert's tone. */
function AlertIcon({ icon, className }: AlertIconProps) {
	const { variant } = useAlertContext();

	return <Icon aria-hidden='true' className={cn('col-start-1 row-span-2 mt-0.5 shrink-0', iconToneClassName[variant], className)} icon={icon ?? defaultIcon[variant]} size='lg' />;
}

export interface AlertTitleProps extends React.HTMLAttributes<HTMLParagraphElement> {}

/** Short headline of the alert. */
function AlertTitle({ className, ...props }: AlertTitleProps) {
	return <p className={cn('col-start-2 font-medium leading-5 text-foreground', className)} {...props} />;
}

export interface AlertDescriptionProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Supporting detail under `Alert.Title` — what happened and what to do about it. */
function AlertDescription({ className, ...props }: AlertDescriptionProps) {
	return <div className={cn('col-start-2 row-start-2 text-muted-foreground [&_p]:leading-relaxed', className)} {...props} />;
}

export interface AlertActionProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Slot for a follow-up action (typically a small secondary `Button`), kept under the text so it never crowds a narrow alert. */
function AlertAction({ className, ...props }: AlertActionProps) {
	return <div className={cn('col-start-2 row-start-3 mt-3 flex gap-2', className)} {...props} />;
}

export interface AlertCloseProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
	/**
	 * Accessible name of the button.
	 * @default "Dismiss"
	 */
	'aria-label'?: string;
}

/** Dismisses the alert. */
function AlertClose({ className, onClick, 'aria-label': ariaLabel = 'Dismiss', ...props }: AlertCloseProps) {
	const { onDismiss } = useAlertContext();

	return (
		<button
			aria-label={ariaLabel}
			className={cn(
				'col-start-3 row-start-1 -mt-1 -mr-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-in-out hover:bg-muted hover:text-foreground',
				'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
				className
			)}
			onClick={event => {
				onClick?.(event);
				onDismiss();
			}}
			type='button'
			{...props}
		>
			<Icon aria-hidden='true' icon={X} size='md' />
		</button>
	);
}

export const Alert = Object.assign(AlertRoot, {
	Action: AlertAction,
	Close: AlertClose,
	Description: AlertDescription,
	Icon: AlertIcon,
	Root: AlertRoot,
	Title: AlertTitle,
});
