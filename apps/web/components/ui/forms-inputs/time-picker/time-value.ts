/**
 * Pure wall-clock arithmetic shared by `TimePicker` and the minute granularity of `DatePicker`.
 * Nothing here touches React or the DOM, so it is unit-tested directly instead of through a story.
 */

/** A wall-clock time with no date and no timezone attached. */
export interface TimeValue {
  /** Hour in 24-hour form, 0–23, regardless of the `hourCycle` used for display. */
  hours: number;
  /** Minute of the hour, 0–59. */
  minutes: number;
}

/** Whether times are displayed on a 24-hour clock or a 12-hour clock with an AM/PM column. */
export type HourCycle = 12 | 24;

/** Last minute of a day, expressed as minutes since midnight. */
export const END_OF_DAY_MINUTES = 23 * 60 + 59;

/** Minutes elapsed since midnight, the comparable scalar form of a `TimeValue`. */
export function timeToMinutes(value: TimeValue): number {
  return value.hours * 60 + value.minutes;
}

/** Rebuilds a `TimeValue` from minutes elapsed since midnight, clamped to a single day. */
export function minutesToTime(total: number): TimeValue {
  const clamped = Math.min(
    END_OF_DAY_MINUTES,
    Math.max(0, Math.round(Number.isFinite(total) ? total : 0)),
  );
  return {
    hours: Math.floor(clamped / 60),
    minutes: clamped % 60,
  };
}

/** Negative when `a` is earlier than `b`, positive when later, zero when equal. */
export function compareTime(a: TimeValue, b: TimeValue): number {
  return timeToMinutes(a) - timeToMinutes(b);
}

/** The wall-clock time a local `Date` sits on, discarding its calendar day. */
export function getTimeFromDate(date: Date): TimeValue {
  return {
    hours: date.getHours(),
    minutes: date.getMinutes(),
  };
}

/** A copy of `date` moved to `time` on the same calendar day, with seconds and ms zeroed. */
export function mergeDayAndTime(date: Date, time: TimeValue): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    time.hours,
    time.minutes,
    0,
    0,
  );
}

/** Serialises a time as the zero-padded 24-hour `"HH:mm"` string every backend `time` column expects. */
export function toTimeString(value: TimeValue): string {
  const hours = String(value.hours).padStart(2, "0");
  const minutes = String(value.minutes).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Human-readable time, on a 24-hour clock or with an AM/PM suffix. */
export function formatTime(
  value: TimeValue,
  hourCycle: HourCycle = 24,
): string {
  const minutes = String(value.minutes).padStart(2, "0");
  if (hourCycle === 24) {
    return `${String(value.hours).padStart(2, "0")}:${minutes}`;
  }
  const meridiem = value.hours >= 12 ? "PM" : "AM";
  const displayHour = value.hours % 12 || 12;
  return `${String(displayHour).padStart(2, "0")}:${minutes} ${meridiem}`;
}

/** Whether `value` falls inside the optional `[minValue, maxValue]` window, both ends inclusive. */
export function isTimeWithinBounds(
  value: TimeValue,
  minValue?: TimeValue,
  maxValue?: TimeValue,
): boolean {
  if (minValue && compareTime(value, minValue) < 0) return false;
  if (maxValue && compareTime(value, maxValue) > 0) return false;
  return true;
}

/** The minute values a column offers for a given step; a non-positive or non-finite step falls back to 1. */
export function buildMinuteOptions(step: number): number[] {
  const safeStep = Number.isFinite(step) && step > 0 ? Math.floor(step) : 1;
  const minutes: number[] = [];
  for (let minute = 0; minute < 60; minute += safeStep) minutes.push(minute);
  return minutes;
}
