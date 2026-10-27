'use client';

import type { LucideIcon } from 'lucide-react';
import { createContext, type ReactNode, useContext, useId, useState } from 'react';
import { Icon } from '../../foundations/icon/icon';
import { cn } from '../../utils/tailwind/cn';

type TabContextValue = {
	readonly baseId: string;
	readonly value: string;
	readonly setValue: (value: string) => void;
};

const TabsContext = createContext<TabContextValue | null>(null);

function useTabsContext(): TabContextValue {
	const context = useContext(TabsContext);
	if (!context) throw new Error('Tabs compound components must be used inside <Tabs>.');
	return context;
}

interface TabsTriggerContextValue {
	readonly active: boolean;
}

const TabsTriggerContext = createContext<TabsTriggerContextValue | null>(null);

function useTabsTriggerContext(): TabsTriggerContextValue {
	const context = useContext(TabsTriggerContext);
	if (!context) {
		throw new Error('Tabs.TriggerTitle/TriggerIcon must be used inside <Tabs.Trigger>.');
	}
	return context;
}

export interface TabsRootProps {
	/** Initial active tab value (uncontrolled usage). */
	readonly defaultValue: string;
	/** Active tab value (controlled usage). */
	readonly value?: string;
	readonly children: ReactNode;
	/** Called with the new value whenever the active tab changes. */
	readonly onValueChange?: (value: string) => void;
}

/** Compound tabs, following the WAI-ARIA Tabs pattern with automatic activation. */
function TabsRoot({ defaultValue, value: controlledValue, children, onValueChange }: TabsRootProps) {
	const baseId = useId();
	const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
	const value = controlledValue !== undefined ? controlledValue : uncontrolledValue;

	const setValue = (next: string) => {
		if (controlledValue === undefined) setUncontrolledValue(next);
		onValueChange?.(next);
	};

	return (
		<TabsContext.Provider
			value={{
				baseId,
				setValue,
				value,
			}}
		>
			{children}
		</TabsContext.Provider>
	);
}

export interface TabsListProps {
	readonly children: ReactNode;
	readonly className?: string;
}

function TabsList({ children, className }: TabsListProps) {
	return (
		<div className={cn('inline-flex w-fit items-center justify-between gap-1 overflow-x-auto rounded-lg bg-muted p-1', className)} role='tablist'>
			{children}
		</div>
	);
}

export interface TabsTriggerProps {
	/** Value this tab activates when selected; must match a sibling `Tabs.Content`'s `value`. */
	readonly value: string;
	readonly children: ReactNode;
	readonly className?: string;
}

function focusTabAt(list: HTMLElement, index: number) {
	const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
	const count = tabs.length;
	if (count === 0) return;
	const target = tabs[((index % count) + count) % count];
	target.focus();
	return target.dataset.value;
}

function TabsTrigger({ value, children, className }: TabsTriggerProps) {
	const { baseId, value: currentValue, setValue } = useTabsContext();
	const active = currentValue === value;

	const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		const list = event.currentTarget.closest('[role="tablist"]');
		if (!(list instanceof HTMLElement)) return;

		const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
		const index = tabs.indexOf(event.currentTarget);
		if (index === -1) return;

		let nextValue: string | undefined;
		if (event.key === 'ArrowRight') nextValue = focusTabAt(list, index + 1);
		else if (event.key === 'ArrowLeft') nextValue = focusTabAt(list, index - 1);
		else if (event.key === 'Home') nextValue = focusTabAt(list, 0);
		else if (event.key === 'End') nextValue = focusTabAt(list, tabs.length - 1);

		if (nextValue !== undefined) {
			event.preventDefault();
			setValue(nextValue);
		}
	};

	return (
		<TabsTriggerContext.Provider
			value={{
				active,
			}}
		>
			<button
				aria-controls={`${baseId}-panel-${value}`}
				aria-selected={active}
				className={cn(
					'group flex flex-row items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium font-primary transition-all duration-150 ease-in-out cursor-pointer',
					'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
					active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
					className
				)}
				data-value={value}
				id={`${baseId}-tab-${value}`}
				onClick={() => setValue(value)}
				onKeyDown={handleKeyDown}
				role='tab'
				tabIndex={active ? 0 : -1}
				type='button'
			>
				{children}
			</button>
		</TabsTriggerContext.Provider>
	);
}

export interface TabsTriggerTitleProps {
	readonly children: ReactNode;
	readonly className?: string;
}

function TabsTriggerTitle({ children, className }: TabsTriggerTitleProps) {
	return <span className={cn('text-[0.8125rem]', className)}>{children}</span>;
}

export interface TabsTriggerIconProps {
	readonly icon: LucideIcon;
	readonly className?: string;
	readonly 'aria-label'?: string;
}

function TabsTriggerIcon({ icon, className, 'aria-label': ariaLabel }: TabsTriggerIconProps) {
	const { active } = useTabsTriggerContext();
	return (
		<Icon
			aria-hidden={!ariaLabel}
			aria-label={ariaLabel}
			className={cn('shrink-0 transition-colors duration-150 ease-in-out', active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground', className)}
			icon={icon}
			size='xs'
		/>
	);
}

export interface TabsContentProps {
	readonly value: string;
	readonly children: ReactNode;
	readonly className?: string;
}

function TabsContent({ value, children, className }: TabsContentProps) {
	const { baseId, value: currentValue } = useTabsContext();
	if (currentValue !== value) return null;

	return (
		<div aria-labelledby={`${baseId}-tab-${value}`} className={cn('w-fit', className)} id={`${baseId}-panel-${value}`} role='tabpanel' tabIndex={0}>
			{children}
		</div>
	);
}

/**
 * Compound tabs.
 * @example
 * ```tsx
 * <Tabs defaultValue="profile">
 *   <Tabs.List>
 *     <Tabs.Trigger value="profile"><Tabs.TriggerTitle>Profile</Tabs.TriggerTitle></Tabs.Trigger>
 *   </Tabs.List>
 *   <Tabs.Content value="profile">...</Tabs.Content>
 * </Tabs>
 * ```
 */
export const Tabs = Object.assign(TabsRoot, {
	Content: TabsContent,
	List: TabsList,
	Trigger: TabsTrigger,
	TriggerIcon: TabsTriggerIcon,
	TriggerTitle: TabsTriggerTitle,
});
