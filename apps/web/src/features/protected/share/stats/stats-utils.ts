import type { Locale } from '~/i18n';
import { todayInDisplayZone } from '~/lib/date-time';

/**
 * The API counts clicks per UTC day (`YYYY-MM-DD`) and per UTC hour. Everything here works on those day strings, so the
 * calendar day the user picks is sent as the UTC day with the same number, never shifted by their offset. "Today" and the
 * hours of the day are the ones of the display time zone (see `lib/date-time`); a day bucket itself cannot be re-cut in the
 * browser, so the daily and weekday charts stay in UTC days.
 */

/** The day the date picker stops at: today in the display time zone. */
export const todayUtc = todayInDisplayZone;

/** Longest period the API accepts is 366 days (a gap of 365 between `from` and `to`). */
export const MAX_RANGE_DAYS = 365;
export const DEFAULT_RANGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, '0');

function toUtcDate(day: string) {
	return new Date(`${day}T00:00:00Z`);
}

export function addDays(day: string, amount: number) {
	return new Date(toUtcDate(day).getTime() + amount * DAY_MS).toISOString().slice(0, 10);
}

/** Days from `from` to `to`, both included. */
export function daysInRange(from: string, to: string) {
	return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / DAY_MS) + 1;
}

export function isDay(value: string | null): value is string {
	return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && toUtcDate(value).toISOString().startsWith(value);
}

/** A UTC day as a local `Date` on the same calendar day, which is what the date picker shows. */
export function dayToPickerDate(day: string) {
	const [year, month, date] = day.split('-').map(Number);
	return new Date(year, month - 1, date);
}

/** The calendar day a picker date shows, as a day string. */
export function pickerDateToDay(date: Date) {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Keeps `from <= to` and the period within what the API allows, moving `from` when needed. */
export function clampRange(from: string, to: string) {
	const earliest = addDays(to, -MAX_RANGE_DAYS);
	return { from: from < earliest ? earliest : from > to ? to : from, to };
}

/** The tag the browser's `Intl` and the date picker understand. */
export function intlLocale(locale: Locale) {
	return locale === 'es' ? 'es-PE' : 'en-US';
}

export function formatShortDay(day: string, locale: Locale) {
	return new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(toUtcDate(day));
}

export function formatLongDay(day: string, locale: Locale) {
	return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeZone: 'UTC' }).format(toUtcDate(day));
}

/** Short weekday name for an index where 0 is Sunday (the API's `by_weekday`). */
export function weekdayName(index: number, locale: Locale) {
	// 2023-01-01 was a Sunday.
	return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: 'UTC', weekday: 'short' }).format(new Date(Date.UTC(2023, 0, 1 + index)));
}

export function countryName(code: string, locale: Locale) {
	try {
		return new Intl.DisplayNames([intlLocale(locale)], { type: 'region' }).of(code) ?? code;
	} catch {
		return code;
	}
}

/** `news.example` for `https://news.example/a/b`; anything that is not a URL is kept as it is. */
export function referrerHost(referrer: string) {
	try {
		return new URL(referrer).host || referrer;
	} catch {
		return referrer;
	}
}
