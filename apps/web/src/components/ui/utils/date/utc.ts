/**
 * Every date column in the backend is a plain `timestamp` — UTC, with no offset stored (see the backend's
 * "Temporal Columns" rule). A calendar day picked in the UI must therefore travel as that same calendar day
 * at UTC midnight, never as the browser's local midnight converted to UTC: `new Date(2026, 0, 15)` serialises
 * to `2026-01-15T05:00:00.000Z` in Lima (UTC-5) but to `2026-01-14T15:00:00.000Z` in Tokyo (UTC+9) — a day
 * earlier than the one the user clicked. Every date that reaches the API goes through `toUtcTimestamp`, and
 * every date that comes back and needs a local `Date` goes through `fromUtcTimestamp`.
 */

/** Which end of a picked range a date represents; a single date is treated as the start of its day. */
export type DateBoundary = "single" | "from" | "to";

const MS_PER_DAY = 86_400_000;

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Midnight UTC of a timestamp's calendar day, as epoch milliseconds. */
function utcStartOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Serialises the calendar day of a local `Date` as the UTC timestamp the backend stores verbatim.
 * A `"to"` boundary is pushed to the last millisecond of the day so an inclusive range filter
 * covers the whole closing day instead of stopping at its midnight.
 */
export function toUtcTimestamp(
  date: Date,
  boundary: DateBoundary = "single",
): string {
  const isEndOfDay = boundary === "to";
  return new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      isEndOfDay ? 23 : 0,
      isEndOfDay ? 59 : 0,
      isEndOfDay ? 59 : 0,
      isEndOfDay ? 999 : 0,
    ),
  ).toISOString();
}

/**
 * Inverse of `toUtcTimestamp`: rebuilds a local `Date` sitting on the same calendar day, so calendars and
 * pickers that read `getDate()`/`getMonth()` highlight the day the backend actually stored.
 */
export function fromUtcTimestamp(
  value: string | null | undefined,
): Date | null {
  const parsed = parse(value);
  if (!parsed) return null;
  return new Date(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  );
}

/** Adds whole days to a UTC timestamp, returning another UTC timestamp at midnight. */
export function addUtcDays(
  value: string | null | undefined,
  days: number,
): string | null {
  const parsed = parse(value);
  if (!parsed || !Number.isFinite(days)) return null;
  return new Date(utcStartOfDay(parsed) + days * MS_PER_DAY).toISOString();
}

/** Whole days from `start` to `end`, both read as UTC calendar days. Negative when `end` precedes `start`. */
export function diffUtcDays(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  const from = parse(start);
  const to = parse(end);
  if (!from || !to) return null;
  return Math.round((utcStartOfDay(to) - utcStartOfDay(from)) / MS_PER_DAY);
}

/**
 * Serialises a local `Date` *with its wall-clock time* as the UTC timestamp the backend stores
 * verbatim — the time-aware sibling of `toUtcTimestamp`, used when a picker has minute granularity
 * and the hour the user chose is part of the value instead of an artefact of the browser's offset.
 * Seconds and milliseconds are zeroed; the `boundary` is irrelevant because an explicit time already
 * says where the range ends.
 */
export function toUtcDateTime(date: Date): string {
  return new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      0,
      0,
    ),
  ).toISOString();
}

/**
 * Inverse of `toUtcDateTime`: rebuilds a local `Date` on the same calendar day *and* the same
 * wall-clock time, so a picker rehydrated from the API highlights the hour the backend stored.
 */
export function fromUtcDateTime(value: string | null | undefined): Date | null {
  const parsed = parse(value);
  if (!parsed) return null;
  return new Date(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
    parsed.getUTCHours(),
    parsed.getUTCMinutes(),
    0,
    0,
  );
}
