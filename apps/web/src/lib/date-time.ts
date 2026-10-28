/**
 * The database stores every timestamp in UTC. Until each user can pick their own country, all of them are
 * shown in Lima (UTC-5, no daylight saving). This is the single place that decides the display time zone:
 * changing it (or reading it from the user's settings later) changes every date in the app.
 */
export const DISPLAY_TIME_ZONE = 'America/Lima';

/** Formats a UTC timestamp from the API as a date and time in `DISPLAY_TIME_ZONE`, or `fallback` when it is missing or invalid. */
export function formatDateTime(value: string | null | undefined, locale?: string, fallback = '—') {
	if (!value) return fallback;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return fallback;
	return new Intl.DateTimeFormat(locale, {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: DISPLAY_TIME_ZONE,
	}).format(date);
}
