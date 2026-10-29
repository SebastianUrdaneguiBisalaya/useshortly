'use client';

import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { createContext, type ReactNode, type RefObject, useCallback, useContext, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../actions-controls/button/button';
import { Icon } from '../../foundations/icon/icon';
import { useClickOutside } from '../../hooks/useClickOutside';
import { usePopoverPosition } from '../../hooks/usePopoverPosition';
import { useEscapeKey } from '../../overlays-feedback/modal/modal';
import { type DateBoundary, toUtcDateTime, toUtcTimestamp } from '../../utils/date/utc';
import { cn } from '../../utils/tailwind/cn';
import { defaultTimeFieldLang, TimeField, type TimeFieldLang } from '../time-picker/time-picker';
import { compareTime, END_OF_DAY_MINUTES, formatTime, getTimeFromDate, type HourCycle, mergeDayAndTime, minutesToTime, type TimeValue, timeToMinutes } from '../time-picker/time-value';

export type { DateBoundary, HourCycle, TimeValue };

export interface DateRangeValue {
	from: Date | null;
	to: Date | null;
}

/** How precise a picked value is: a calendar day, or a calendar day plus hour and minute. */
export type DateGranularity = 'day' | 'minute';

type FormatFn = (date: Date, boundary: DateBoundary) => string;
type DisplayFormatFn = (date: Date) => string;

type SingleRootProps = {
	/** Picks a single date instead of a range. @default "single" */
	mode?: 'single';
	/** Selected date, for controlled usage. */
	value?: Date | null;
	/** Initial selected date, for uncontrolled usage. */
	defaultValue?: Date | null;
	/** Called with the picked date and its formatted string whenever selection commits. */
	onChange?: (value: Date | null, formatted: string | null) => void;
};

type RangeRootProps = {
	/** Picks a `from`/`to` date range. */
	mode: 'range';
	/** Selected range, for controlled usage. */
	value?: DateRangeValue;
	/** Initial selected range, for uncontrolled usage. */
	defaultValue?: DateRangeValue;
	/** Called with the picked range and its formatted strings when "Apply" is pressed. */
	onChange?: (
		value: DateRangeValue,
		formatted: {
			from: string | null;
			to: string | null;
		}
	) => void;
};

type DatePickerRootProps = (SingleRootProps | RangeRootProps) & {
	children: ReactNode;
	/**
	 * Whether the value carries a time of day. With `"minute"` the popover grows an hour/minute
	 * column set (one per boundary in range mode) and selection only commits on apply,
	 * because the hour is picked after the day. @default "day"
	 */
	granularity?: DateGranularity;
	/** Minutes between consecutive options in the minute column. Ignored unless granularity is `"minute"`. @default 1 */
	minuteStep?: number;
	/** 24-hour columns, or 12-hour columns plus an AM/PM column. Also drives the default display format. @default 24 */
	hourCycle?: HourCycle;
	/** Time a freshly picked day starts at (`from` in range mode). Ignored unless granularity is `"minute"`. @default 00:00 */
	defaultTime?: TimeValue;
	/** Time a freshly picked `to` day ends at, in range mode. Ignored unless granularity is `"minute"`. @default 23:59 */
	defaultEndTime?: TimeValue;
	/**
	 * Earliest selectable date; earlier days render disabled. With `"minute"` granularity its
	 * time of day also bounds the hour columns on that first day.
	 */
	minDate?: Date;
	/**
	 * Latest selectable date; later days render disabled. With `"minute"` granularity its
	 * time of day also bounds the hour columns on that last day.
	 */
	maxDate?: Date;
	/** Number of month panels rendered side by side. Defaults to 2 for range mode, 1 for single. */
	numberOfMonths?: number;
	/**
	 * Formats the committed date(s) into the string passed to `onChange`.
	 * Receives the boundary ("from"/"to" for range mode).
	 * @default `toUtcTimestamp` — the picked calendar day at UTC midnight ("to" at 23:59:59.999),
	 * which is the shape every backend `timestamp` column expects; with `"minute"` granularity it
	 * is `toUtcDateTime` instead, which keeps the hour the user actually chose. Override only for
	 * a non-API consumer.
	 */
	format?: FormatFn;
	/**
	 * Formats a date for human display in the trigger and calendar header.
	 * @default a `locale` day/month/year string, suffixed with the time when granularity is `"minute"`
	 */
	displayFormat?: DisplayFormatFn;
	/**
	 * BCP 47 locale used to format the month/year header and, by default, `displayFormat`.
	 * @default "en-US"
	 */
	locale?: string;
	/**
	 * Texts rendered by subcomponents that have no override prop of their own. Merges over English defaults.
	 * @default defaultDatePickerLang
	 */
	lang?: Partial<DatePickerLang>;
	className?: string;
};

type DatePickerContextType = {
	triggerId: string;
	mode: 'single' | 'range';
	granularity: DateGranularity;
	minuteStep: number;
	hourCycle: HourCycle;
	open: boolean;
	setOpen: (open: boolean) => void;
	triggerRef: RefObject<HTMLButtonElement | null>;
	contentRef: RefObject<HTMLDivElement | null>;
	singleValue: Date | null;
	rangeValue: DateRangeValue;
	draftSingle: Date | null;
	draftRange: DateRangeValue;
	draftTimes: {
		from: TimeValue;
		to: TimeValue;
	};
	setDraftTime: (boundary: 'from' | 'to', value: TimeValue) => void;
	hoverDay: Date | null;
	setHoverDay: (day: Date | null) => void;
	minDate?: Date;
	maxDate?: Date;
	numberOfMonths: number;
	viewDate: Date;
	setViewDate: (date: Date) => void;
	selectDay: (day: Date) => void;
	clear: () => void;
	apply: () => void;
	displayFormat: DisplayFormatFn;
	locale: string;
	lang: DatePickerLang;
};

const DatePickerContext = createContext<DatePickerContextType | null>(null);

function useDatePickerContext() {
	const context = useContext(DatePickerContext);
	if (!context) {
		throw new Error('DatePicker components must be used inside DatePicker.Root');
	}
	return context;
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function defaultDisplayFormat(date: Date, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	}).format(date);
}

/** Texts rendered by `DatePicker`'s subcomponents that have no override prop of their own. Pass `lang` to `DatePicker.Root` to override any of them. */
export interface DatePickerLang extends TimeFieldLang {
	/** Accessible label for the calendar dialog. */
	calendar: string;
	/** Accessible name/tooltip of the "previous month" button. */
	previousMonth: string;
	/** Accessible name/tooltip of the "next month" button. */
	nextMonth: string;
	/** Label above the start time field, in range mode with time. */
	from: string;
	/** Label above the end time field, in range mode with time. */
	to: string;
	/** Label of the "clear selection" button. */
	clear: string;
	/** Label of the "apply selection" button. */
	apply: string;
	/** Mon–Sun weekday abbreviations shown above the day grid. */
	weekdays: readonly [string, string, string, string, string, string, string];
}

/** English defaults for `DatePickerLang`. */
export const defaultDatePickerLang: DatePickerLang = {
	...defaultTimeFieldLang,
	apply: 'Apply',
	calendar: 'Calendar',
	clear: 'Clear',
	from: 'From',
	nextMonth: 'Next month',
	previousMonth: 'Previous month',
	to: 'To',
	weekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
};

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addMonths(date: Date, amount: number): Date {
	return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function isSameDay(a: Date | null, b: Date | null): boolean {
	if (!a || !b) return false;
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isBeforeDay(a: Date, b: Date): boolean {
	return startOfDay(a).getTime() < startOfDay(b).getTime();
}

function isWithinRange(day: Date, from: Date, to: Date): boolean {
	const time = startOfDay(day).getTime();
	return time > startOfDay(from).getTime() && time < startOfDay(to).getTime();
}

/**
 * Time-of-day bounds the hour columns must respect for a given day: `minDate`/`maxDate` only
 * constrain the clock on the very first and very last selectable day, and a range's closing day
 * additionally can't start before its own opening time when both land on the same day.
 */
function timeBoundsForDay(
	day: Date | null,
	minDate: Date | undefined,
	maxDate: Date | undefined,
	sameDayFloor?: TimeValue
): {
	maxValue?: TimeValue;
	minValue?: TimeValue;
} {
	let minValue = day && minDate && isSameDay(day, minDate) ? getTimeFromDate(minDate) : undefined;
	const maxValue = day && maxDate && isSameDay(day, maxDate) ? getTimeFromDate(maxDate) : undefined;
	if (sameDayFloor && (!minValue || compareTime(sameDayFloor, minValue) > 0)) {
		minValue = sameDayFloor;
	}
	return {
		maxValue,
		minValue,
	};
}

function getMonthGrid(year: number, month: number): (Date | null)[] {
	const firstDay = new Date(year, month, 1);
	const daysInMonth = new Date(year, month + 1, 0).getDate();
	const startOffset = (firstDay.getDay() + 6) % 7;
	const cells: (Date | null)[] = Array.from(
		{
			length: startOffset,
		},
		() => null
	);
	for (let day = 1; day <= daysInMonth; day++) {
		cells.push(new Date(year, month, day));
	}
	while (cells.length % 7 !== 0) cells.push(null);
	return cells;
}

// ─── Root ────────────────────────────────────────────────────────────────────

/** Root of the compound date picker; owns open state, selection, and calendar navigation. */
function Root(props: DatePickerRootProps) {
	const { children, className, displayFormat: displayFormatProp, format: formatProp, granularity = 'day', hourCycle = 24, maxDate, minDate, minuteStep = 1, locale = 'en-US', lang } = props;
	const resolvedLang = { ...defaultDatePickerLang, ...lang };
	const mode: 'single' | 'range' = props.mode === 'range' ? 'range' : 'single';
	const withTime = granularity === 'minute';
	const numberOfMonths = props.numberOfMonths ?? (mode === 'range' ? 2 : 1);
	const isControlled = 'value' in props;
	const format = formatProp ?? (withTime ? toUtcDateTime : toUtcTimestamp);

	// Kept as primitives so the open/reset callback below isn't invalidated by a fresh
	// `defaultTime={{ hours: 9, minutes: 0 }}` object literal on every parent render.
	const defaultStartMinutes = props.defaultTime ? timeToMinutes(props.defaultTime) : 0;
	const defaultEndMinutes = props.defaultEndTime ? timeToMinutes(props.defaultEndTime) : END_OF_DAY_MINUTES;

	const triggerId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	const [openState, setOpenState] = useState(false);
	const [hoverDay, setHoverDay] = useState<Date | null>(null);

	const [internalSingle, setInternalSingle] = useState<Date | null>(mode === 'single' ? ((props as SingleRootProps).defaultValue ?? null) : null);
	const [internalRange, setInternalRange] = useState<DateRangeValue>(
		mode === 'range'
			? ((props as RangeRootProps).defaultValue ?? {
					from: null,
					to: null,
				})
			: {
					from: null,
					to: null,
				}
	);

	const singleValue = mode === 'single' ? (isControlled ? ((props as SingleRootProps).value ?? null) : internalSingle) : null;
	const rangeValue: DateRangeValue =
		mode === 'range'
			? isControlled
				? ((props as RangeRootProps).value ?? {
						from: null,
						to: null,
					})
				: internalRange
			: {
					from: null,
					to: null,
				};

	const [draftSingle, setDraftSingle] = useState<Date | null>(singleValue);
	const [draftRange, setDraftRange] = useState<DateRangeValue>(rangeValue);
	const [draftTimes, setDraftTimes] = useState<{
		from: TimeValue;
		to: TimeValue;
	}>(() => {
		const start = mode === 'range' ? rangeValue.from : singleValue;
		return {
			from: start ? getTimeFromDate(start) : minutesToTime(defaultStartMinutes),
			to: rangeValue.to ? getTimeFromDate(rangeValue.to) : minutesToTime(defaultEndMinutes),
		};
	});
	const [viewDate, setViewDate] = useState<Date>(() => startOfDay(rangeValue.from ?? singleValue ?? new Date()));

	const setOpen = useCallback(
		(value: boolean) => {
			setOpenState(value);
			if (!value) return;
			const start = mode === 'range' ? rangeValue.from : singleValue;
			setDraftSingle(singleValue);
			setDraftRange(rangeValue);
			setDraftTimes({
				from: start ? getTimeFromDate(start) : minutesToTime(defaultStartMinutes),
				to: rangeValue.to ? getTimeFromDate(rangeValue.to) : minutesToTime(defaultEndMinutes),
			});
			setHoverDay(null);
			setViewDate(startOfDay(rangeValue.from ?? singleValue ?? new Date()));
		},
		[defaultEndMinutes, defaultStartMinutes, mode, rangeValue, singleValue]
	);

	useClickOutside(rootRef, () => setOpen(false), contentRef);
	useEscapeKey(openState, () => setOpen(false));

	const setDraftTime = useCallback((boundary: 'from' | 'to', value: TimeValue) => {
		setDraftTimes(prev => ({
			...prev,
			[boundary]: value,
		}));
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: props identity changes every render; only reacting to isControlled/format is intentional
	const commitSingle = useCallback(
		(day: Date | null) => {
			if (!isControlled) setInternalSingle(day);
			(props as SingleRootProps).onChange?.(day, day ? format(day, 'single') : null);
		},
		[isControlled, format]
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: props identity changes every render; only reacting to isControlled/format is intentional
	const commitRange = useCallback(
		(next: DateRangeValue) => {
			if (!isControlled) setInternalRange(next);
			(props as RangeRootProps).onChange?.(next, {
				from: next.from ? format(next.from, 'from') : null,
				to: next.to ? format(next.to, 'to') : null,
			});
		},
		[isControlled, format]
	);

	const selectDay = useCallback(
		(day: Date) => {
			if (mode === 'single') {
				// With a time to pick the day is only a draft: committing here would close the
				// popover before the hour columns were ever reachable.
				if (withTime) {
					setDraftSingle(day);
					return;
				}
				commitSingle(day);
				setOpen(false);
				return;
			}
			setDraftRange(prev => {
				if (!prev.from || prev.to) {
					return {
						from: day,
						to: null,
					};
				}
				if (isBeforeDay(day, prev.from)) {
					return {
						from: day,
						to: null,
					};
				}
				return {
					from: prev.from,
					to: day,
				};
			});
		},
		[mode, withTime, commitSingle, setOpen]
	);

	const clear = useCallback(() => {
		setDraftSingle(null);
		setDraftRange({
			from: null,
			to: null,
		});
		if (mode === 'single') {
			commitSingle(null);
			setOpen(false);
			return;
		}
		commitRange({
			from: null,
			to: null,
		});
		setOpen(false);
	}, [mode, commitSingle, commitRange, setOpen]);

	const apply = useCallback(() => {
		if (mode === 'single') {
			commitSingle(draftSingle ? (withTime ? mergeDayAndTime(draftSingle, draftTimes.from) : draftSingle) : null);
			setOpen(false);
			return;
		}
		commitRange({
			from: draftRange.from && withTime ? mergeDayAndTime(draftRange.from, draftTimes.from) : draftRange.from,
			to: draftRange.to && withTime ? mergeDayAndTime(draftRange.to, draftTimes.to) : draftRange.to,
		});
		setOpen(false);
	}, [commitRange, commitSingle, draftRange, draftSingle, draftTimes, mode, setOpen, withTime]);

	const displayFormat = useMemo<DisplayFormatFn>(() => {
		if (displayFormatProp) return displayFormatProp;
		if (!withTime) return (date: Date) => defaultDisplayFormat(date, locale);
		return (date: Date) => `${defaultDisplayFormat(date, locale)} · ${formatTime(getTimeFromDate(date), hourCycle)}`;
	}, [displayFormatProp, hourCycle, locale, withTime]);

	const contextValue = useMemo<DatePickerContextType>(
		() => ({
			apply,
			clear,
			contentRef,
			displayFormat,
			draftRange,
			draftSingle,
			draftTimes,
			granularity,
			hourCycle,
			hoverDay,
			lang: resolvedLang,
			locale,
			maxDate,
			minDate,
			minuteStep,
			mode,
			numberOfMonths,
			open: openState,
			rangeValue,
			selectDay,
			setDraftTime,
			setHoverDay,
			setOpen,
			setViewDate,
			singleValue,
			triggerId,
			triggerRef,
			viewDate,
		}),
		[
			apply,
			clear,
			displayFormat,
			draftRange,
			draftSingle,
			draftTimes,
			granularity,
			hourCycle,
			hoverDay,
			resolvedLang,
			locale,
			maxDate,
			minDate,
			minuteStep,
			mode,
			numberOfMonths,
			triggerId,
			openState,
			rangeValue,
			selectDay,
			setDraftTime,
			setOpen,
			singleValue,
			viewDate,
		]
	);

	return (
		<DatePickerContext.Provider value={contextValue}>
			<div className={cn('relative flex w-full flex-col gap-1.5', className)} ref={rootRef}>
				{children}
			</div>
		</DatePickerContext.Provider>
	);
}

// ─── Label ───────────────────────────────────────────────────────────────────

export interface DatePickerLabelProps {
	children: ReactNode;
	className?: string;
	/** Appends a required-field indicator (`*`) after the label text. */
	required?: boolean;
}

/** Optional label associated with `DatePicker.Trigger` via `htmlFor`/`id`. */
function Label({ children, className, required }: DatePickerLabelProps) {
	const { triggerId } = useDatePickerContext();
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

export interface DatePickerTriggerProps {
	/** Text shown when no date is selected. @default "Select a date" */
	placeholder?: string;
	className?: string;
	/** Prevents opening the calendar and dims the control. @default false */
	disabled?: boolean;
}

/** Button that opens the calendar and displays the current selection. */
function Trigger({ placeholder = 'Select a date', className, disabled }: DatePickerTriggerProps) {
	const { triggerId, mode, open, setOpen, triggerRef, singleValue, rangeValue, displayFormat } = useDatePickerContext();

	let label: string | null = null;
	if (mode === 'single') {
		label = singleValue ? displayFormat(singleValue) : null;
	} else if (rangeValue.from && rangeValue.to) {
		label = `${displayFormat(rangeValue.from)} – ${displayFormat(rangeValue.to)}`;
	} else if (rangeValue.from) {
		label = `${displayFormat(rangeValue.from)} – …`;
	}

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
			<Icon className='shrink-0 text-muted-foreground' icon={CalendarIcon} size='sm' />
			<span className={cn('truncate', !label && 'text-muted-foreground')}>{label ?? placeholder}</span>
		</button>
	);
}

// ─── Calendar ────────────────────────────────────────────────────────────────

function DayCell({ day }: { day: Date | null }) {
	const { granularity, mode, minDate, maxDate, singleValue, draftSingle, draftRange, hoverDay, setHoverDay, selectDay } = useDatePickerContext();

	if (!day) return <span />;

	const disabled = (minDate !== undefined && isBeforeDay(day, minDate)) || (maxDate !== undefined && isBeforeDay(maxDate, day));

	const isToday = isSameDay(day, new Date());

	let isSelected = false;
	let isRangeStart = false;
	let isRangeEnd = false;
	let isInRange = false;

	if (mode === 'single') {
		// With a time to pick, the highlight has to follow the uncommitted draft day.
		isSelected = isSameDay(day, granularity === 'minute' ? draftSingle : singleValue);
	} else {
		const previewTo = draftRange.to ?? (hoverDay && draftRange.from && !isBeforeDay(hoverDay, draftRange.from) ? hoverDay : null);
		isRangeStart = isSameDay(day, draftRange.from);
		isRangeEnd = isSameDay(day, previewTo);
		isInRange = Boolean(draftRange.from && previewTo && isWithinRange(day, draftRange.from, previewTo));
	}

	return (
		<button
			aria-pressed={isSelected || isRangeStart || isRangeEnd}
			className={cn(
				'flex h-8 w-8 items-center justify-center rounded-full text-sm font-primary transition-colors duration-150',
				'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
				disabled ? 'cursor-not-allowed text-foreground-tertiary' : 'cursor-pointer',
				// `hover:bg-muted` only for cells that aren't already painted solid
				// by the block below — applying it to a selected/range-endpoint cell
				// would fight its `bg-foreground`/`text-background` pair on hover
				// (dark `--muted` behind dark `text-background` in dark mode).
				!disabled && !isSelected && !isRangeStart && !isRangeEnd && 'hover:bg-muted',
				isInRange && 'rounded-none bg-muted',
				(isRangeStart || isRangeEnd || isSelected) && 'bg-foreground text-background hover:opacity-90',
				!isSelected && !isRangeStart && !isRangeEnd && isToday && 'font-semibold text-foreground'
			)}
			disabled={disabled}
			onClick={() => selectDay(day)}
			onMouseEnter={() => setHoverDay(day)}
			onMouseLeave={() => setHoverDay(null)}
			type='button'
		>
			{day.getDate()}
		</button>
	);
}

function MonthPanel({ monthDate }: { monthDate: Date }) {
	const { locale, lang } = useDatePickerContext();
	const grid = useMemo(() => getMonthGrid(monthDate.getFullYear(), monthDate.getMonth()), [monthDate]);
	const title = new Intl.DateTimeFormat(locale, {
		month: 'long',
		year: 'numeric',
	}).format(monthDate);

	return (
		<div className='flex min-w-58 flex-1 flex-col gap-2 p-2'>
			<p className='text-center text-sm font-medium font-primary capitalize text-foreground'>{title}</p>
			<div className='grid grid-cols-7 place-items-center gap-y-1'>
				{lang.weekdays.map(label => (
					<span className='text-center text-xs font-primary text-muted-foreground' key={label}>
						{label}
					</span>
				))}
				{grid.map((day, index) => (
					<DayCell day={day} key={day ? day.toISOString() : `blank-${monthDate.getTime()}-${index}`} />
				))}
			</div>
		</div>
	);
}

/** Hour/minute columns rendered under the calendar: one set in single mode, one per boundary in range mode. */
function TimeRow() {
	const { draftRange, draftSingle, draftTimes, hourCycle, maxDate, minDate, minuteStep, mode, setDraftTime, lang } = useDatePickerContext();

	const setFrom = useCallback((value: TimeValue) => setDraftTime('from', value), [setDraftTime]);
	const setTo = useCallback((value: TimeValue) => setDraftTime('to', value), [setDraftTime]);

	if (mode === 'single') {
		const bounds = timeBoundsForDay(draftSingle, minDate, maxDate);
		return (
			<div className='mt-3 sm:mt-0 sm:self-center sm:border-l sm:border-border sm:pl-3'>
				<TimeField hourCycle={hourCycle} lang={lang} maxValue={bounds.maxValue} minuteStep={minuteStep} minValue={bounds.minValue} onChange={setFrom} value={draftTimes.from} />
			</div>
		);
	}

	const fromBounds = timeBoundsForDay(draftRange.from, minDate, maxDate);
	const toBounds = timeBoundsForDay(draftRange.to, minDate, maxDate, isSameDay(draftRange.from, draftRange.to) ? draftTimes.from : undefined);

	// Each boundary tracks the month panel above it (same `flex-1` as `MonthPanel`)
	// instead of floating centred between the two.
	return (
		<div className='mt-3 flex flex-col gap-3 sm:flex-row'>
			<div className='flex flex-1 flex-col gap-1'>
				<span className='text-center text-xs font-medium font-primary text-foreground'>{lang.from}</span>
				<TimeField hourCycle={hourCycle} lang={lang} maxValue={fromBounds.maxValue} minuteStep={minuteStep} minValue={fromBounds.minValue} onChange={setFrom} value={draftTimes.from} />
			</div>
			<div className='flex flex-1 flex-col gap-1'>
				<span className='text-center text-xs font-medium font-primary text-foreground'>{lang.to}</span>
				<TimeField hourCycle={hourCycle} lang={lang} maxValue={toBounds.maxValue} minuteStep={minuteStep} minValue={toBounds.minValue} onChange={setTo} value={draftTimes.to} />
			</div>
		</div>
	);
}

export interface DatePickerContentProps {
	className?: string;
}

/**
 * Portaled calendar popover: month navigation, day grid(s), the hour/minute columns when
 * granularity is `"minute"`, and the Clear/Apply actions whenever selection has to be committed.
 */
function Content({ className }: DatePickerContentProps) {
	const { open, contentRef, triggerRef, viewDate, setViewDate, numberOfMonths, granularity, mode, draftRange, draftSingle, draftTimes, clear, apply, lang } = useDatePickerContext();
	const style = usePopoverPosition(open, triggerRef, contentRef);

	if (!open) return null;

	const withTime = granularity === 'minute';
	const needsFooter = mode === 'range' || withTime;

	let canApply: boolean;
	if (mode === 'single') {
		canApply = Boolean(draftSingle);
	} else if (!draftRange.from || !draftRange.to) {
		canApply = false;
	} else {
		// A same-day range can't close before it opens once the hour is part of the value.
		canApply = !withTime || !isSameDay(draftRange.from, draftRange.to) || compareTime(draftTimes.to, draftTimes.from) >= 0;
	}

	return createPortal(
		<div aria-label={lang.calendar} className={cn('rounded-md border border-border bg-background p-2 shadow-md', className)} ref={contentRef} role='dialog' style={style}>
			<div className='flex items-center justify-between px-2 pt-1'>
				<button
					aria-label={lang.previousMonth}
					className='flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!'
					onClick={() => setViewDate(addMonths(viewDate, -1))}
					type='button'
				>
					<Icon icon={ChevronLeft} size='sm' />
				</button>
				<button
					aria-label={lang.nextMonth}
					className='flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!'
					onClick={() => setViewDate(addMonths(viewDate, 1))}
					type='button'
				>
					<Icon icon={ChevronRight} size='sm' />
				</button>
			</div>

			<div className={cn('flex flex-col', withTime && mode === 'single' && 'sm:flex-row')}>
				<div className='flex flex-col sm:flex-row'>
					{Array.from(
						{
							length: numberOfMonths,
						},
						(_, index) => {
							const monthDate = addMonths(viewDate, index);
							return <MonthPanel key={`${monthDate.getFullYear()}-${monthDate.getMonth()}`} monthDate={monthDate} />;
						}
					)}
				</div>

				{withTime && <TimeRow />}
			</div>

			{needsFooter && (
				<div className='mt-2 flex items-center justify-end gap-2 border-t border-border px-2 pt-2 pb-1'>
					<Button onClick={clear} type='button' variant='secondary'>
						<Button.Text>{lang.clear}</Button.Text>
					</Button>
					<Button disabled={!canApply} onClick={apply} type='button' variant='primary'>
						<Button.Text>{lang.apply}</Button.Text>
					</Button>
				</div>
			)}
		</div>,
		document.body
	);
}

/**
 * Compound date picker: a single date or a range, optionally carrying an hour and minute.
 * @example
 * ```tsx
 * <DatePicker.Root defaultValue={null} onChange={setDate}>
 *   <DatePicker.Label>Date</DatePicker.Label>
 *   <DatePicker.Trigger />
 *   <DatePicker.Content />
 * </DatePicker.Root>
 * ```
 * @example Day plus time, committed on apply
 * ```tsx
 * <DatePicker.Root granularity="minute" minuteStep={15} onChange={setDate}>
 *   <DatePicker.Label>Inicio</DatePicker.Label>
 *   <DatePicker.Trigger />
 *   <DatePicker.Content />
 * </DatePicker.Root>
 * ```
 */
export const DatePicker = {
	Content,
	Label,
	Root,
	Trigger,
};
