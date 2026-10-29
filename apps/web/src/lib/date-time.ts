import { useTimeZoneStore } from '~/stores/time-zone-store';
import { timeZoneOf } from './time-zones';

/**
 * The database stores every timestamp in UTC. Every date of the app is shown in the time zone of the country the user
 * picked in the settings (Peru, America/Lima, by default). This is the single place that decides it: changing the
 * country (`useTimeZoneStore`) changes every date. It is read when a date is formatted, so the screens remount on a
 * change (see the protected layout) to show the new zone.
 */
export function getDisplayTimeZone() {
	return timeZoneOf(useTimeZoneStore.getState().country);
}

/** Formats a UTC timestamp from the API as a date and time in the display time zone, or `fallback` when it is missing or invalid. */
export function formatDateTime(value: string | null | undefined, locale?: string, fallback = '—') {
	if (!value) return fallback;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return fallback;
	return new Intl.DateTimeFormat(locale, {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: getDisplayTimeZone(),
	}).format(date);
}

/** The calendar day (`YYYY-MM-DD`) it is right now in the display time zone. */
export function todayInDisplayZone(now = new Date()) {
	return new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', timeZone: getDisplayTimeZone(), year: 'numeric' }).format(now);
}
