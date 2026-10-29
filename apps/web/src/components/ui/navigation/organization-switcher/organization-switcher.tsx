'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import * as React from 'react';
import { Icon } from '../../foundations/icon/icon';
import { Dropdown, type DropdownContentProps, type DropdownProps } from '../../overlays-feedback/dropdown/dropdown';
import { cn } from '../../utils/tailwind/cn';

interface OrganizationSwitcherContextValue {
	/** Currently selected organization id, if any. */
	value: string | undefined;
	setValue: (value: string) => void;
}

const OrganizationSwitcherContext = React.createContext<OrganizationSwitcherContextValue | null>(null);

function useOrganizationSwitcher() {
	const context = React.useContext(OrganizationSwitcherContext);

	if (!context) {
		throw new Error('OrganizationSwitcher compound components must be used inside <OrganizationSwitcher>.');
	}

	return context;
}

const logoVariants = cva('inline-flex shrink-0 items-center justify-center overflow-hidden bg-muted font-primary font-medium text-foreground', {
	defaultVariants: {
		size: 'md',
	},
	variants: {
		size: {
			md: 'size-10 rounded-lg text-sm',
			sm: 'size-8 rounded-md text-xs',
		},
	},
});

function getInitials(name: string) {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map(word => word.charAt(0).toLocaleUpperCase())
		.join('');
}

/* --------------------------------------- root --------------------------------------- */

export interface OrganizationSwitcherProps extends Omit<DropdownProps, 'children'> {
	/** Id of the selected organization (controlled). */
	value?: string;
	/** Id of the initially selected organization when uncontrolled. */
	defaultValue?: string;
	/** Called with the chosen organization's id when the user picks a different one. */
	onValueChange?: (value: string) => void;
	/** The trigger and the content of the switcher. */
	children: React.ReactNode;
}

/**
 * Root of the organization switcher: a menu button that shows the active organization and lists the others
 * to switch to. Built on `Dropdown`, so it inherits its positioning, Escape / click-outside closing and
 * arrow-key navigation. It owns only the selected `value` and shares it through Context.
 *
 * @example
 * ```tsx
 * <OrganizationSwitcher value={orgId} onValueChange={setOrgId}>
 *   <OrganizationSwitcher.Trigger>
 *     <OrganizationSwitcher.Logo name="Temelio Foundation" />
 *     <OrganizationSwitcher.Details>
 *       <OrganizationSwitcher.Name>Temelio Foundation</OrganizationSwitcher.Name>
 *       <OrganizationSwitcher.Description>Foundation</OrganizationSwitcher.Description>
 *     </OrganizationSwitcher.Details>
 *   </OrganizationSwitcher.Trigger>
 *   <OrganizationSwitcher.Content>
 *     <OrganizationSwitcher.Item value="temelio">…</OrganizationSwitcher.Item>
 *     <OrganizationSwitcher.Action onSelect={create}>New Foundation</OrganizationSwitcher.Action>
 *   </OrganizationSwitcher.Content>
 * </OrganizationSwitcher>
 * ```
 */
function OrganizationSwitcherRoot({ children, defaultValue, onValueChange, value: valueProp, ...dropdownProps }: OrganizationSwitcherProps) {
	const [internalValue, setInternalValue] = React.useState(defaultValue);
	const isControlled = valueProp !== undefined;
	const value = isControlled ? valueProp : internalValue;

	const setValue = React.useCallback(
		(next: string) => {
			if (!isControlled) setInternalValue(next);
			onValueChange?.(next);
		},
		[isControlled, onValueChange]
	);

	const context = React.useMemo(
		() => ({
			setValue,
			value,
		}),
		[setValue, value]
	);

	return (
		<OrganizationSwitcherContext.Provider value={context}>
			<Dropdown {...dropdownProps}>{children}</Dropdown>
		</OrganizationSwitcherContext.Provider>
	);
}

/* -------------------------------------- trigger -------------------------------------- */

export interface OrganizationSwitcherTriggerProps extends Omit<React.ComponentProps<'button'>, 'children'> {
	/**
	 * Content of the trigger, usually a `Logo` and `Details` for the active organization. Pass a function to
	 * receive the selected `value`. The up/down chevron is appended automatically.
	 */
	children?: React.ReactNode | ((value: string | undefined) => React.ReactNode);
	/** Classes for the element wrapping the button, which positions the menu; add `w-full` there too to stretch across a sidebar. */
	wrapperClassName?: string;
}

/**
 * The button that shows the active organization and opens the menu. It hugs its content; give it
 * `className="w-full"` to stretch it across a sidebar.
 */
function OrganizationSwitcherTrigger({ children, className, type = 'button', wrapperClassName, ...props }: OrganizationSwitcherTriggerProps) {
	const { value } = useOrganizationSwitcher();

	return (
		<Dropdown.Trigger className={wrapperClassName}>
			<button
				type={type}
				{...props}
				className={cn(
					'group/switcher flex w-fit cursor-pointer items-center gap-3 rounded-lg p-2 text-left font-primary transition-colors duration-150 ease-in-out hover:bg-hover aria-expanded:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
					className
				)}
			>
				{typeof children === 'function' ? children(value) : children}
				<Icon aria-hidden='true' className='ml-auto text-foreground-secondary' icon={ChevronsUpDown} />
			</button>
		</Dropdown.Trigger>
	);
}

/* --------------------------------------- content --------------------------------------- */

export interface OrganizationSwitcherContentProps extends DropdownContentProps {}

/** Floating panel with the list of organizations and the trailing action. Portaled and positioned by `Dropdown`. */
function OrganizationSwitcherContent({ align = 'start', className, ...props }: OrganizationSwitcherContentProps) {
	return <Dropdown.Content align={align} className={cn('flex min-w-64 flex-col gap-1 rounded-xl p-1.5', className)} {...props} />;
}

export interface OrganizationSwitcherItemProps {
	/** Id of the organization this row selects. Compared against the root's `value`. */
	value: string;
	/** Row content, usually a `Logo` and `Details`. */
	children: React.ReactNode;
	/**
	 * Prevents the row from being chosen.
	 * @default false
	 */
	disabled?: boolean;
	/**
	 * Text announced by screen readers on the selected row, since the check icon is decorative.
	 * @default "Seleccionada"
	 */
	selectedLabel?: string;
	/** Additional classes for the row. */
	className?: string;
}

/**
 * One organization in the list. Choosing it calls `onValueChange` and closes the menu. The selected row is
 * filled and marked with a check (and announced through `selectedLabel`, so it isn't conveyed by sight alone).
 */
function OrganizationSwitcherItem({ children, className, disabled, selectedLabel = 'Selected', value }: OrganizationSwitcherItemProps) {
	const { setValue, value: selected } = useOrganizationSwitcher();
	const isSelected = selected === value;

	return (
		<Dropdown.Item className={cn('gap-3 rounded-lg px-2 py-2', isSelected && 'bg-muted', className)} disabled={disabled} onSelect={() => setValue(value)}>
			{children}
			{isSelected ? (
				<>
					<Icon aria-hidden='true' className='ml-auto' icon={Check} />
					<span className='sr-only'>{selectedLabel}</span>
				</>
			) : null}
		</Dropdown.Item>
	);
}

export interface OrganizationSwitcherActionProps {
	/** Called when the action is chosen. Closes the menu afterward. */
	onSelect: () => void;
	/** Label of the action (e.g. "New Foundation"). */
	children: React.ReactNode;
	/**
	 * Show a leading plus icon.
	 * @default true
	 */
	showIcon?: boolean;
	/** Additional classes for the action. */
	className?: string;
}

/** Bordered full-width action at the end of the list, such as "New organization". Not a selectable organization. */
function OrganizationSwitcherAction({ children, className, onSelect, showIcon = true }: OrganizationSwitcherActionProps) {
	return (
		<Dropdown.Item className={cn('mt-1 justify-center gap-2 rounded-lg border border-border px-3 py-2 font-medium', className)} onSelect={onSelect}>
			{showIcon ? <Icon aria-hidden='true' icon={Plus} /> : null}
			{children}
		</Dropdown.Item>
	);
}

/* ---------------------------------- building blocks ---------------------------------- */

export interface OrganizationSwitcherLogoProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>, VariantProps<typeof logoVariants> {
	/**
	 * Size of the logo tile.
	 * @default "md"
	 */
	size?: 'sm' | 'md';
	/** Image URL of the organization's logo. */
	src?: string;
	/** Organization name; its initials are shown when there is no `src` and no `children`. */
	name?: string;
	/** Custom mark (an SVG, a gradient…) that replaces both the image and the initials. */
	children?: React.ReactNode;
}

/**
 * Square logo tile. Decorative (`aria-hidden`): the organization's name is always rendered next to it. Logos
 * are brand marks, so they keep their own colors.
 */
function OrganizationSwitcherLogo({ children, className, name, size = 'md', src, ...props }: OrganizationSwitcherLogoProps) {
	return (
		<span
			aria-hidden='true'
			{...props}
			className={cn(
				logoVariants({
					size,
				}),
				className
			)}
		>
			{children ?? (src ? <img alt='' className='size-full object-cover' src={src} /> : name ? getInitials(name) : null)}
		</span>
	);
}

export interface OrganizationSwitcherDetailsProps extends React.HTMLAttributes<HTMLSpanElement> {}

/** Vertical stack holding an organization's `Name` and `Description`. */
function OrganizationSwitcherDetails({ className, ...props }: OrganizationSwitcherDetailsProps) {
	return <span {...props} className={cn('flex min-w-0 flex-col', className)} />;
}

export interface OrganizationSwitcherNameProps extends React.HTMLAttributes<HTMLSpanElement> {}

/** Organization name. Truncates instead of wrapping. */
function OrganizationSwitcherName({ className, ...props }: OrganizationSwitcherNameProps) {
	return <span {...props} className={cn('truncate font-primary text-sm leading-5 font-medium text-foreground', className)} />;
}

export interface OrganizationSwitcherDescriptionProps extends React.HTMLAttributes<HTMLSpanElement> {}

/** Secondary line under the name, such as the organization type or plan. */
function OrganizationSwitcherDescription({ className, ...props }: OrganizationSwitcherDescriptionProps) {
	return <span {...props} className={cn('truncate font-primary text-xs leading-4 text-foreground-secondary', className)} />;
}

export const OrganizationSwitcher = Object.assign(OrganizationSwitcherRoot, {
	Action: OrganizationSwitcherAction,
	Content: OrganizationSwitcherContent,
	Description: OrganizationSwitcherDescription,
	Details: OrganizationSwitcherDetails,
	Item: OrganizationSwitcherItem,
	Logo: OrganizationSwitcherLogo,
	Name: OrganizationSwitcherName,
	Trigger: OrganizationSwitcherTrigger,
});
