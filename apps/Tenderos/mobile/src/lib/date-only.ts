/**
 * The ONE date formatter every user-facing date in this app goes through (S11).
 *
 * Two rules, and both are the reason this module exists instead of a
 * `toLocaleDateString` call at each call site:
 *
 * - It never emits hours, minutes or seconds. The tendero and the customer see
 *   days, never clock times.
 * - It never shifts the day. The API hands over date-only `YYYY-MM-DD` strings
 *   (the coupon validity columns are DATE), and `new Date("2026-01-01")` parses
 *   that as UTC midnight — which reads as 2025-12-31 on any device west of
 *   UTC, including every device in the app's own calendar zone
 *   (`America/Bogota`, UTC-5). So the value is read with plain string
 *   arithmetic and no `Date` is constructed anywhere in this file.
 */

/** Shown when a date is absent or unusable, so a screen never renders a blank. */
export const DATE_ONLY_FALLBACK = "Sin fecha";

const MONTHS_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

/** Anchored, so a datetime spelling such as `2026-01-01T00:00:00Z` never matches. */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DateOnlyParts = {
  year: number;
  month: number;
  day: number;
};

const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number) =>
  month === 2
    ? isLeapYear(year)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;

/**
 * Reads a date-only string into its parts, or null when the value is not a real
 * calendar date. The day is checked against the month it is in — leap years
 * included — because the tendero types these dates into the coupon form and
 * `z.iso.date()` on the backend rejects a day the month does not have.
 */
export function parseDateOnly(
  value: string | null | undefined,
): DateOnlyParts | null {
  if (typeof value !== "string") return null;
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return { year, month, day };
}

/** Whether a value is a usable date-only string, with no time part at all. */
export function isDateOnly(value: string | null | undefined): boolean {
  return parseDateOnly(value) !== null;
}

/** `2026-11-03` → `3 nov 2026`. */
export function formatDateOnly(
  value: string | null | undefined,
  fallback: string = DATE_ONLY_FALLBACK,
): string {
  const parts = parseDateOnly(value);
  if (!parts) return fallback;
  return `${parts.day} ${MONTHS_ES[parts.month - 1]} ${parts.year}`;
}

/**
 * A validity window as one string. It falls back as a WHOLE when either end is
 * unusable: half a range is more misleading than no range.
 */
export function formatDateOnlyRange(
  from: string | null | undefined,
  to: string | null | undefined,
  fallback: string = DATE_ONLY_FALLBACK,
): string {
  if (!isDateOnly(from) || !isDateOnly(to)) return fallback;
  return `${formatDateOnly(from)} - ${formatDateOnly(to)}`;
}
