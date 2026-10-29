'use client';

import { Clock as ClockIcon } from 'lucide-react';
import { createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../actions-controls/button/button';
import { Icon } from '../../foundations/icon/icon';
import { useClickOutside } from '../../hooks/useClickOutside';
import { usePopoverPosition } from '../../hooks/usePopoverPosition';
import { useEscapeKey } from '../../overlays-feedback/modal/modal';
import { cn } from '../../utils/tailwind/cn';
import {
	buildMinuteOptions,
	compareTime,
	END_OF_DAY_MINUTES,
	formatTime,
	getTimeFromDate,
	type HourCycle,
	isTimeWithinBounds,
	mergeDayAndTime,
	minutesToTime,
	type TimeValue,
	timeToMinutes,
	toTimeString,
} from './time-value';

export type { HourCycle, TimeValue };
export { buildMinuteOptions, compareTime, END_OF_DAY_MINUTES, formatTime, getTimeFromDate, isTimeWithinBounds, mergeDayAndTime, minutesToTime, timeToMinutes, toTimeString };

type TimeFormatFn = (value: TimeValue) => string;

// ─── TimeField ───────────────────────────────────────────────────────────────

type ColumnOption = {
	disabled: boolean;
	label: string;
	value: number;
};

/**
 * One scrollable listbox column (hours, minutes or meridiem): roving tabindex, arrow/Home/End
 * navigation with selection following focus, and the selected option scrolled into view.
 */
function TimeColumn({
	ariaLabel,
	heading,
	onSelect,
	options,
	selected,
	width,
}: {
	ariaLabel: string;
	heading: string;
	onSelect: (value: number) => void;
	options: ColumnOption[];
	selected: number | null;
	width: string;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	const enabledOptions = options.filter(option => !option.disabled);
	const activeValue = selected !== null && options.some(option => option.value === selected) ? selected : (enabledOptions[0]?.value ?? null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the DOM query reads the selection instead of `selected` itself, but the scroll must re-run whenever it changes
	useEffect(() => {
		listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({
			block: 'nearest',
		});
	}, [selected]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (enabledOptions.length === 0) return;
			const currentIndex = enabledOptions.findIndex(option => option.value === activeValue);
			let nextIndex: number;
			switch (event.key) {
				case 'ArrowDown':
					nextIndex = Math.min(enabledOptions.length - 1, currentIndex + 1);
					break;
				case 'ArrowUp':
					nextIndex = Math.max(0, currentIndex - 1);
					break;
				case 'Home':
					nextIndex = 0;
					break;
				case 'End':
					nextIndex = enabledOptions.length - 1;
					break;
				default:
					return;
			}
			event.preventDefault();
			const next = enabledOptions[nextIndex];
			onSelect(next.value);
			listRef.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
		},
		[activeValue, enabledOptions, onSelect]
	);

	return (
		<div className='flex flex-col gap-1'>
			<span className='text-center text-xs font-primary whitespace-nowrap text-muted-foreground'>{heading}</span>
			{/* The listbox container is never itself tabbable: focus lives on its options via roving tabindex. */}
			<div
				aria-label={ariaLabel}
				className={cn('flex max-h-48 flex-col gap-0.5 overflow-y-auto px-1 scrollbar-quiet', '[scrollbar-gutter:stable_both-edges]', width)}
				onKeyDown={handleKeyDown}
				ref={listRef}
				role='listbox'
				tabIndex={-1}
			>
				{options.map(option => {
					const isSelected = option.value === selected;
					return (
						<button
							aria-selected={isSelected}
							className={cn(
								'flex h-8 shrink-0 items-center justify-center rounded-md text-sm font-primary transition-colors duration-150',
								'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
								option.disabled ? 'cursor-not-allowed text-foreground-tertiary' : 'cursor-pointer',
								!option.disabled && !isSelected && 'hover:bg-muted',
								isSelected && 'bg-foreground text-background hover:opacity-90'
							)}
							data-selected={isSelected}
							data-value={option.value}
							disabled={option.disabled}
							key={option.value}
							onClick={() => onSelect(option.value)}
							role='option'
							tabIndex={option.value === activeValue ? 0 : -1}
							type='button'
						>
							{option.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

/** Texts rendered by `TimeField`'s columns. Pass `lang` to override any of them. */
export interface TimeFieldLang {
	/** Heading and accessible name of the hour column. */
	hour: string;
	/** Heading and accessible name of the minute column. */
	minute: string;
	/** Heading and accessible name of the AM/PM column. */
	meridiem: string;
	/** Label of the AM option. */
	am: string;
	/** Label of the PM option. */
	pm: string;
}

/** English defaults for `TimeFieldLang`. */
export const defaultTimeFieldLang: TimeFieldLang = {
	am: 'AM',
	hour: 'Hour',
	meridiem: 'AM/PM',
	minute: 'Minute',
	pm: 'PM',
};

export interface TimeFieldProps {
	/** Currently picked time, or `null` when nothing is picked yet. */
	value: TimeValue | null;
	/** Called with the next time whenever an hour, minute or meridiem is picked. */
	onChange: (value: TimeValue) => void;
	/** Minutes between consecutive options in the minute column. @default 1 */
	minuteStep?: number;
	/** 24-hour columns, or 12-hour columns plus an AM/PM column. @default 24 */
	hourCycle?: HourCycle;
	/** Earliest selectable time; earlier options render disabled. */
	minValue?: TimeValue;
	/** Latest selectable time; later options render disabled. */
	maxValue?: TimeValue;
	/**
	 * Texts rendered by the columns. Merges over English defaults.
	 * @default defaultTimeFieldLang
	 */
	lang?: Partial<TimeFieldLang>;
	className?: string;
}

/**
 * Bare hour/minute picker: the scrollable listbox columns shared by `TimePicker.Content` and
 * the time row of `DatePicker.Content`. Renders no popover and no label of its own.
 */
export function TimeField({ className, hourCycle = 24, lang, maxValue, minValue, minuteStep = 1, onChange, value }: TimeFieldProps) {
	const resolvedLang = { ...defaultTimeFieldLang, ...lang };
	const minuteOptions = useMemo(() => buildMinuteOptions(minuteStep), [minuteStep]);

	const minutesForProbe = value?.minutes ?? 0;
	const hoursForProbe = value?.hours ?? minValue?.hours ?? 0;
	const isPm = hoursForProbe >= 12;

	const hourOptions = useMemo<ColumnOption[]>(() => {
		// 24-hour columns list 00–23. 12-hour columns list the twelve hours of the currently
		// selected half (0–11 or 12–23) and label them 12, 01 … 11, so switching meridiem
		// re-labels nothing and only the underlying 24-hour values shift by twelve.
		const source = Array.from(
			{
				length: hourCycle === 24 ? 24 : 12,
			},
			(_, index) => (hourCycle === 24 ? index : index + (isPm ? 12 : 0))
		);
		return source.map(hour => ({
			// Every minute option is out of range for this hour → the hour itself is unreachable.
			disabled: !minuteOptions.some(minute =>
				isTimeWithinBounds(
					{
						hours: hour,
						minutes: minute,
					},
					minValue,
					maxValue
				)
			),
			label: hourCycle === 24 ? String(hour).padStart(2, '0') : String(hour % 12 || 12).padStart(2, '0'),
			value: hour,
		}));
	}, [hourCycle, isPm, maxValue, minValue, minuteOptions]);

	const minuteColumnOptions = useMemo<ColumnOption[]>(
		() =>
			minuteOptions.map(minute => ({
				disabled: !isTimeWithinBounds(
					{
						hours: hoursForProbe,
						minutes: minute,
					},
					minValue,
					maxValue
				),
				label: String(minute).padStart(2, '0'),
				value: minute,
			})),
		[hoursForProbe, maxValue, minValue, minuteOptions]
	);

	const meridiemOptions = useMemo<ColumnOption[]>(() => {
		if (hourCycle === 24) return [];
		return [0, 1].map(half => ({
			disabled: !Array.from(
				{
					length: 12,
				},
				(_, index) => index + half * 12
			).some(hour =>
				minuteOptions.some(minute =>
					isTimeWithinBounds(
						{
							hours: hour,
							minutes: minute,
						},
						minValue,
						maxValue
					)
				)
			),
			label: half === 0 ? resolvedLang.am : resolvedLang.pm,
			value: half,
		}));
	}, [hourCycle, maxValue, minValue, minuteOptions, resolvedLang]);

	const selectHour = useCallback(
		(hour: number) => {
			onChange({
				hours: hour,
				minutes: minutesForProbe,
			});
		},
		[minutesForProbe, onChange]
	);

	const selectMinute = useCallback(
		(minute: number) => {
			onChange({
				hours: hoursForProbe,
				minutes: minute,
			});
		},
		[hoursForProbe, onChange]
	);

	const selectMeridiem = useCallback(
		(half: number) => {
			onChange({
				hours: (hoursForProbe % 12) + half * 12,
				minutes: minutesForProbe,
			});
		},
		[hoursForProbe, minutesForProbe, onChange]
	);

	return (
		<div className={cn('flex items-start justify-center gap-1', className)}>
			<TimeColumn ariaLabel={resolvedLang.hour} heading={resolvedLang.hour} onSelect={selectHour} options={hourOptions} selected={value ? value.hours : null} width='w-14' />
			{/* Mirrors a column's heading + first row so the colon lands on the first option
          without an offset hand-tuned to the heading's rendered height. */}
			<div aria-hidden='true' className='flex flex-col gap-1'>
				<span className='text-xs'>&nbsp;</span>
				<span className='flex h-8 items-center text-sm font-primary text-muted-foreground'>:</span>
			</div>
			<TimeColumn ariaLabel={resolvedLang.minute} heading={resolvedLang.minute} onSelect={selectMinute} options={minuteColumnOptions} selected={value ? value.minutes : null} width='w-14' />
			{hourCycle === 12 && (
				<TimeColumn
					ariaLabel={resolvedLang.meridiem}
					heading={resolvedLang.meridiem}
					onSelect={selectMeridiem}
					options={meridiemOptions}
					selected={value ? (value.hours >= 12 ? 1 : 0) : null}
					width='w-16'
				/>
			)}
		</div>
	);
}

// ─── Root ────────────────────────────────────────────────────────────────────

/** Texts rendered by `TimePicker`'s subcomponents. Pass `lang` to `TimePicker.Root` to override any of them. */
export interface TimePickerLang extends TimeFieldLang {
	/** Accessible name of the picker popover. */
	picker: string;
	/** Label of the "clear" button. */
	clear: string;
	/** Label of the "apply" button. */
	apply: string;
}

/** English defaults for `TimePickerLang`. */
export const defaultTimePickerLang: TimePickerLang = {
	...defaultTimeFieldLang,
	apply: 'Apply',
	clear: 'Clear',
	picker: 'Time picker',
};

export interface TimePickerRootProps {
	children: ReactNode;
	/**
	 * Texts rendered by subcomponents that have no override prop of their own. Merges over English defaults.
	 * @default defaultTimePickerLang
	 */
	lang?: Partial<TimePickerLang>;
	/** Selected time, for controlled usage. */
	value?: TimeValue | null;
	/** Initial selected time, for uncontrolled usage. @default null */
	defaultValue?: TimeValue | null;
	/** Called with the picked time and its formatted string when apply is pressed. */
	onChange?: (value: TimeValue | null, formatted: string | null) => void;
	/** Minutes between consecutive options in the minute column. @default 1 */
	minuteStep?: number;
	/** 24-hour columns, or 12-hour columns plus an AM/PM column. @default 24 */
	hourCycle?: HourCycle;
	/** Earliest selectable time; earlier options render disabled. */
	minTime?: TimeValue;
	/** Latest selectable time; later options render disabled. */
	maxTime?: TimeValue;
	/**
	 * Formats the committed time into the string passed to `onChange`.
	 * @default `toTimeString` — zero-padded 24-hour `"HH:mm"`, the shape a backend `time` column expects.
	 */
	format?: TimeFormatFn;
	/** Formats a time for human display in the trigger. @default `formatTime` honouring `hourCycle` */
	displayFormat?: TimeFormatFn;
	className?: string;
}

type TimePickerContextType = {
	lang: TimePickerLang;
	triggerId: string;
	open: boolean;
	setOpen: (open: boolean) => void;
	triggerRef: RefObject<HTMLButtonElement | null>;
	contentRef: RefObject<HTMLDivElement | null>;
	value: TimeValue | null;
	draft: TimeValue | null;
	setDraft: (value: TimeValue) => void;
	minuteStep: number;
	hourCycle: HourCycle;
	minTime?: TimeValue;
	maxTime?: TimeValue;
	clear: () => void;
	apply: () => void;
	displayFormat: TimeFormatFn;
};

const TimePickerContext = createContext<TimePickerContextType | null>(null);

function useTimePickerContext() {
	const context = useContext(TimePickerContext);
	if (!context) {
		throw new Error('TimePicker components must be used inside TimePicker.Root');
	}
	return context;
}

/** Root of the compound time picker; owns open state, the draft time, and commit/clear. */
function Root(props: TimePickerRootProps) {
	const { children, className, format = toTimeString, hourCycle = 24, lang, maxTime, minTime, minuteStep = 1 } = props;
	const resolvedLang = { ...defaultTimePickerLang, ...lang };
	const isControlled = 'value' in props;

	const triggerId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	const [openState, setOpenState] = useState(false);
	const [internalValue, setInternalValue] = useState<TimeValue | null>(props.defaultValue ?? null);

	const value = isControlled ? (props.value ?? null) : internalValue;
	const [draft, setDraft] = useState<TimeValue | null>(value);

	const displayFormat = useMemo<TimeFormatFn>(() => props.displayFormat ?? ((time: TimeValue) => formatTime(time, hourCycle)), [props.displayFormat, hourCycle]);

	const setOpen = useCallback(
		(next: boolean) => {
			setOpenState(next);
			if (next) setDraft(value);
		},
		[value]
	);

	useClickOutside(rootRef, () => setOpen(false), contentRef, openState);
	useEscapeKey(openState, () => setOpen(false));

	// biome-ignore lint/correctness/useExhaustiveDependencies: props identity changes every render; only reacting to isControlled/format is intentional
	const commit = useCallback(
		(next: TimeValue | null) => {
			if (!isControlled) setInternalValue(next);
			props.onChange?.(next, next ? format(next) : null);
		},
		[isControlled, format]
	);

	const clear = useCallback(() => {
		setDraft(null);
		commit(null);
		setOpen(false);
	}, [commit, setOpen]);

	const apply = useCallback(() => {
		commit(draft);
		setOpen(false);
	}, [commit, draft, setOpen]);

	const contextValue = useMemo<TimePickerContextType>(
		() => ({
			apply,
			clear,
			contentRef,
			displayFormat,
			draft,
			hourCycle,
			lang: resolvedLang,
			maxTime,
			minTime,
			minuteStep,
			open: openState,
			setDraft,
			setOpen,
			triggerId,
			triggerRef,
			value,
		}),
		[apply, clear, displayFormat, draft, hourCycle, resolvedLang, maxTime, minTime, minuteStep, openState, setOpen, triggerId, value]
	);

	return (
		<TimePickerContext.Provider value={contextValue}>
			<div className={cn('relative inline-block w-full', className)} ref={rootRef}>
				{children}
			</div>
		</TimePickerContext.Provider>
	);
}

// ─── Label ───────────────────────────────────────────────────────────────────

export interface TimePickerLabelProps {
	children: ReactNode;
	className?: string;
	/** Appends a required-field indicator (`*`) after the label text. */
	required?: boolean;
}

/** Optional label associated with `TimePicker.Trigger` via `htmlFor`/`id`. */
function Label({ children, className, required }: TimePickerLabelProps) {
	const { triggerId } = useTimePickerContext();
	return (
		<label className={cn('text-sm font-medium font-primary text-foreground', className)} htmlFor={triggerId}>
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

// ─── Trigger ─────────────────────────────────────────────────────────────────

export interface TimePickerTriggerProps {
	/** Text shown when no time is selected. @default "Select a time" */
	placeholder?: string;
	className?: string;
	/** Prevents opening the popover and dims the control. @default false */
	disabled?: boolean;
}

/** Button that opens the time columns and displays the current selection. */
function Trigger({ className, disabled, placeholder = 'Select a time' }: TimePickerTriggerProps) {
	const { displayFormat, open, setOpen, triggerId, triggerRef, value } = useTimePickerContext();

	const label = value ? displayFormat(value) : null;

	return (
		<button
			aria-haspopup='dialog'
			className={cn(
				'flex h-9 w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left',
				'font-primary text-sm text-foreground transition-colors duration-150 ease-in-out',
				'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
				disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
				className
			)}
			disabled={disabled}
			id={triggerId}
			onClick={() => setOpen(!open)}
			ref={triggerRef}
			type='button'
		>
			<Icon className='shrink-0 text-muted-foreground' icon={ClockIcon} size='sm' />
			<span className={cn('truncate', !label && 'text-muted-foreground')}>{label ?? placeholder}</span>
		</button>
	);
}

// ─── Content ─────────────────────────────────────────────────────────────────

export interface TimePickerContentProps {
	className?: string;
}

/** Portaled popover with the hour/minute columns and the Clear/Apply actions. */
function Content({ className }: TimePickerContentProps) {
	const { apply, clear, contentRef, draft, hourCycle, maxTime, minTime, minuteStep, open, setDraft, lang, triggerRef } = useTimePickerContext();
	const style = usePopoverPosition(open, triggerRef, contentRef);

	if (!open) return null;

	return createPortal(
		<div aria-label={lang.picker} className={cn('rounded-md border border-border bg-background p-2 shadow-md', className)} ref={contentRef} role='dialog' style={style}>
			<TimeField hourCycle={hourCycle} maxValue={maxTime} minuteStep={minuteStep} minValue={minTime} lang={lang} onChange={setDraft} value={draft} />
			<div className='mt-2 flex items-center justify-end gap-2 border-t border-border px-2 pt-2 pb-1'>
				<Button onClick={clear} type='button' variant='secondary'>
					<Button.Text>{lang.clear}</Button.Text>
				</Button>
				<Button disabled={!draft} onClick={apply} type='button' variant='primary'>
					<Button.Text>{lang.apply}</Button.Text>
				</Button>
			</div>
		</div>,
		document.body
	);
}

/**
 * Compound time-only picker (hours and minutes, no calendar).
 * @example
 * ```tsx
 * <TimePicker.Root minuteStep={15} onChange={(value, formatted) => save(formatted)}>
 *   <TimePicker.Label>Hora</TimePicker.Label>
 *   <TimePicker.Trigger />
 *   <TimePicker.Content />
 * </TimePicker.Root>
 * ```
 */
export const TimePicker = {
	Content,
	Label,
	Root,
	Trigger,
};
