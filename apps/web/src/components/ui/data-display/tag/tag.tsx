'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { type LucideIcon, X } from 'lucide-react';
import * as React from 'react';
import { Icon } from '../../foundations/icon/icon';
import { cn } from '../../utils/tailwind/cn';

const tagVariants = cva('inline-flex w-fit max-w-full shrink-0 items-center gap-1 rounded-md border font-primary font-medium transition-colors duration-150 ease-in-out', {
	defaultVariants: {
		color: 'default',
		size: 'md',
	},
	variants: {
		color: {
			amber: 'border-transparent bg-chart-2 text-black',
			blue: 'border-transparent bg-chart-1 text-black',
			default: 'border-transparent bg-muted text-foreground',
			green: 'border-transparent bg-chart-3 text-black',
			outline: 'border-border bg-transparent text-foreground',
			rose: 'border-transparent bg-chart-4 text-black',
			teal: 'border-transparent bg-chart-6 text-black',
			violet: 'border-transparent bg-chart-5 text-black',
		},
		size: {
			md: 'h-7 px-2.5 text-sm',
			sm: 'h-6 px-2 text-xs',
		},
	},
});

export type TagColor = NonNullable<VariantProps<typeof tagVariants>['color']>;
export type TagSize = NonNullable<VariantProps<typeof tagVariants>['size']>;

interface TagContextValue {
	disabled: boolean;
}

const TagContext = React.createContext<TagContextValue | null>(null);

function useTagContext() {
	const context = React.useContext(TagContext);
	if (!context) {
		throw new Error('Tag subcomponents must be used within <Tag>.');
	}
	return context;
}

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
	/**
	 * Color of the tag: a neutral fill, an outline, or one of the pastel chart colors (the same `--chart-*` tokens the charts use, with light and dark values).
	 * @default "default"
	 */
	color?: TagColor;
	/**
	 * Size of the tag.
	 * @default "md"
	 */
	size?: TagSize;
	/**
	 * Dims the tag and disables its `Tag.Remove` button.
	 * @default false
	 */
	disabled?: boolean;
}

/**
 * Compound tag — a chip for a value the user picked or typed (a label, a
 * filter, a recipient), optionally removable with `Tag.Remove`. Unlike
 * `Badge` (a static status label) and `Pill` (a status dot), a tag represents
 * data the user can take away. Renders a `<span>`.
 * @example
 * ```tsx
 * <Tag color="blue">
 *   <Tag.Icon icon={Hash} />
 *   <Tag.Text>design</Tag.Text>
 *   <Tag.Remove label="Remove design" onClick={() => remove("design")} />
 * </Tag>
 * ```
 */
function TagRoot({ color = 'default', size = 'md', disabled = false, className, ...props }: TagProps) {
	const value = React.useMemo(
		() => ({
			disabled,
		}),
		[disabled]
	);

	return (
		<TagContext.Provider value={value}>
			<span
				aria-disabled={disabled || undefined}
				className={cn(
					tagVariants({
						color,
						size,
					}),
					disabled && 'opacity-50',
					className
				)}
				{...props}
			/>
		</TagContext.Provider>
	);
}

export interface TagTextProps extends React.HTMLAttributes<HTMLSpanElement> {}

/** Label of the tag. Truncates with an ellipsis when the tag is narrower than its text. */
function TagText({ className, ...props }: TagTextProps) {
	return <span className={cn('truncate', className)} {...props} />;
}

export interface TagIconProps {
	/** Lucide icon component to render before the text. */
	icon: LucideIcon;
	className?: string;
}

/** Decorative leading icon. */
function TagIcon({ icon, className }: TagIconProps) {
	return <Icon aria-hidden='true' className={className} icon={icon} size='xs' />;
}

export interface TagRemoveProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
	/**
	 * Accessible name of the button. Include the tag's text (e.g. `"Remove design"`) so screen reader users know which tag it removes.
	 * @default "Remove"
	 */
	label?: string;
}

/** Small × button that removes the tag. Disabled together with its `Tag`. */
function TagRemove({ label = 'Remove', className, type = 'button', disabled, ...props }: TagRemoveProps) {
	const { disabled: tagDisabled } = useTagContext();

	return (
		<button
			aria-label={label}
			className={cn(
				'-mr-1 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm opacity-70 transition-opacity duration-150 ease-in-out hover:opacity-100',
				'focus-visible:outline-2! focus-visible:outline-offset-1! focus-visible:outline-ring!',
				'disabled:cursor-not-allowed',
				className
			)}
			disabled={disabled ?? tagDisabled}
			type={type}
			{...props}
		>
			<Icon aria-hidden='true' icon={X} size='xs' />
		</button>
	);
}

export const Tag = Object.assign(TagRoot, {
	Icon: TagIcon,
	Remove: TagRemove,
	Text: TagText,
});
