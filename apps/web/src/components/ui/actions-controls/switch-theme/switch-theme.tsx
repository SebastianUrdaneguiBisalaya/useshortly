'use client';

import type { LucideIcon } from 'lucide-react';
import { Monitor, Moon, Sun } from 'lucide-react';
import * as React from 'react';
import { Icon } from '../../foundations/icon/icon';
import { cn } from '../../utils/tailwind/cn';

/** `"system"` follows the OS preference; `"light"`/`"dark"` are explicit. Matches `next-themes`' own `theme` value shape, so its `useTheme()` return can be passed straight through. */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'ui-theme';

/** Texts rendered by `SwitchTheme`. Pass `lang` to override any of them. */
export interface SwitchThemeLang {
	/** Accessible label for the radiogroup itself. */
	groupLabel: string;
	/** Label/accessible name for the "system" option. */
	system: string;
	/** Label/accessible name for the "light" option. */
	light: string;
	/** Label/accessible name for the "dark" option. */
	dark: string;
}

/** English defaults for `SwitchThemeLang`. */
export const defaultSwitchThemeLang: SwitchThemeLang = {
	dark: 'Dark',
	groupLabel: 'Theme',
	light: 'Light',
	system: 'System',
};

const OPTION_ICONS: {
	value: ThemePreference;
	icon: LucideIcon;
}[] = [
	{
		icon: Monitor,
		value: 'system',
	},
	{
		icon: Sun,
		value: 'light',
	},
	{
		icon: Moon,
		value: 'dark',
	},
];

/** Sets (or removes, for "system") `data-theme` on `<html>` — the mechanism `index.css`'s tokens key off. Only used in uncontrolled mode; a controlled consumer (e.g. `next-themes`) owns applying the theme itself. */
function applyTheme(preference: ThemePreference) {
	if (preference === 'system') {
		document.documentElement.removeAttribute('data-theme');
	} else {
		document.documentElement.setAttribute('data-theme', preference);
	}
}

/** Matches the `size-7`/`gap-0.5`/`p-0.5` classes below exactly — the sliding thumb's offset is computed from these, not measured, since the layout is fixed. */
const OPTION_SIZE_PX = 28;
const OPTION_GAP_PX = 2;
const CONTAINER_PADDING_PX = 2;

function focusOptionAt(group: HTMLElement, index: number) {
	const buttons = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
	if (buttons.length === 0) return;
	buttons[((index % buttons.length) + buttons.length) % buttons.length].focus();
}

export interface SwitchThemeProps {
	/**
	 * Current theme, for controlled usage — e.g. `next-themes`' `theme`, or
	 * any other theme library's state. When provided, this component is
	 * purely presentational: it calls `onValueChange` and never touches
	 * `data-theme`/`localStorage` itself, since the controlling library
	 * already owns that.
	 */
	value?: ThemePreference;
	/** Initial theme, for uncontrolled usage. @default "system" */
	defaultValue?: ThemePreference;
	/** Called with the newly selected theme, controlled or not. */
	onValueChange?: (theme: ThemePreference) => void;
	className?: string;
	/**
	 * Uncontrolled usage only — persists the choice in `localStorage` so it
	 * survives a reload. Ignored when `value` is provided.
	 * @default true
	 */
	persist?: boolean;
	/**
	 * Texts rendered by this component. Merges over English defaults.
	 * @default defaultSwitchThemeLang
	 */
	lang?: Partial<SwitchThemeLang>;
}

/**
 * Three-way theme switcher (System/Light/Dark), a segmented control
 * following the WAI-ARIA radio-group pattern. Not a compound component: the
 * three options are intrinsic to what a theme switcher is, not something a
 * consumer picks apart or extends.
 *
 * Uncontrolled by default: reads the initial value from `localStorage` (if
 * `persist`) or "system" in an effect after mount — never during the
 * initial render, so a server-rendered page's markup always matches the
 * client's first paint — and applies it by setting `data-theme` on `<html>`.
 * Pass `value`/`onValueChange` to hand control to `next-themes` or another
 * theme library instead; in that mode this component renders the UI only.
 * @example
 * ```tsx
 * // Standalone, owns its own persistence/DOM attribute:
 * <SwitchTheme />
 *
 * // Controlled by next-themes:
 * const { theme, setTheme } = useTheme();
 * <SwitchTheme onValueChange={setTheme} value={theme as ThemePreference} />
 * ```
 */
export function SwitchTheme({ value: controlledValue, defaultValue = 'system', onValueChange, className, persist = true, lang }: SwitchThemeProps) {
	const resolvedLang = { ...defaultSwitchThemeLang, ...lang };
	const OPTIONS = OPTION_ICONS.map(option => ({
		...option,
		label: resolvedLang[option.value],
	}));
	const isControlled = controlledValue !== undefined;
	const [uncontrolledValue, setUncontrolledValue] = React.useState<ThemePreference | null>(isControlled ? null : defaultValue);

	React.useEffect(() => {
		if (isControlled) return;
		const stored = persist ? (window.localStorage.getItem(STORAGE_KEY) as ThemePreference | null) : null;
		const initial = stored ?? defaultValue;
		setUncontrolledValue(initial);
		applyTheme(initial);
		// Only re-run if `persist` changes — `defaultValue`/`isControlled` are read once, at mount, matching every other uncontrolled component in this library.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [persist]);

	const value = isControlled ? controlledValue : uncontrolledValue;

	const select = (next: ThemePreference) => {
		if (!isControlled) {
			setUncontrolledValue(next);
			applyTheme(next);
			if (persist) window.localStorage.setItem(STORAGE_KEY, next);
		}
		onValueChange?.(next);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		const group = event.currentTarget.closest('[role="radiogroup"]');
		if (!(group instanceof HTMLElement)) return;

		const buttons = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
		const index = buttons.indexOf(event.currentTarget);
		if (index === -1) return;

		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
			event.preventDefault();
			const nextIndex = (index + 1) % OPTIONS.length;
			focusOptionAt(group, nextIndex);
			select(OPTIONS[nextIndex].value);
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
			event.preventDefault();
			const nextIndex = (index - 1 + OPTIONS.length) % OPTIONS.length;
			focusOptionAt(group, nextIndex);
			select(OPTIONS[nextIndex].value);
		}
	};

	const activeIndex = OPTIONS.findIndex(option => option.value === value);

	return (
		<div aria-label={resolvedLang.groupLabel} className={cn('relative inline-flex items-center gap-0.5 rounded-full border border-border bg-background p-0.5', className)} role='radiogroup'>
			<span
				aria-hidden='true'
				className='absolute z-0 rounded-full bg-foreground'
				style={{
					height: OPTION_SIZE_PX,
					left: CONTAINER_PADDING_PX,
					opacity: activeIndex === -1 ? 0 : 1,
					top: CONTAINER_PADDING_PX,
					transform: `translateX(${Math.max(activeIndex, 0) * (OPTION_SIZE_PX + OPTION_GAP_PX)}px)`,
					transitionDuration: '200ms',
					transitionProperty: 'transform, opacity',
					transitionTimingFunction: 'ease-out',
					width: OPTION_SIZE_PX,
				}}
			/>
			{OPTIONS.map((option, index) => {
				const isActive = value === option.value;
				return (
					<button
						aria-checked={isActive}
						aria-label={option.label}
						className={cn(
							'relative z-10 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 ease-in-out',
							'disabled:cursor-not-allowed disabled:opacity-50',
							'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
							isActive ? 'text-background' : 'text-muted-foreground hover:text-foreground'
						)}
						disabled={value === null}
						key={option.value}
						onClick={() => select(option.value)}
						onKeyDown={handleKeyDown}
						role='radio'
						tabIndex={isActive || (value === null && index === 0) ? 0 : -1}
						type='button'
					>
						<Icon icon={option.icon} size='sm' />
					</button>
				);
			})}
		</div>
	);
}
