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

/** Whole hours the display time zone is ahead of UTC (-5 for Lima), as of `at`. */
export function displayUtcOffsetHours(at = new Date()) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', { day: 'numeric', hour: 'numeric', hourCycle: 'h23', minute: 'numeric', month: 'numeric', timeZone: getDisplayTimeZone(), year: 'numeric' })
			.formatToParts(at)
			.map(part => [part.type, Number(part.value)])
	);
	const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
	const utc = Math.floor(at.getTime() / 60_000) * 60_000;
	return Math.round((local - utc) / 3_600_000);
}

/** Moves the 24 per-hour counts the API reports in UTC (index 0..23) to the hours of the display time zone. */
export function hoursInDisplayZone(byUtcHour: number[], at = new Date()) {
	const offset = displayUtcOffsetHours(at);
	const out = new Array<number>(24).fill(0);
	byUtcHour.forEach((clicks, hour) => {
		out[(((hour + offset) % 24) + 24) % 24] = clicks;
	});
	return out;
}
