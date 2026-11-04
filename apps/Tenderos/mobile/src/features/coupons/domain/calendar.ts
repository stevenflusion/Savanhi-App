import { parseDateOnly } from "@/src/lib/date-only";

/**
 * The month grid and the from/to range rule of the coupon validity calendar
 * (S13), with no React, no dependency and — like `date-only.ts` — no `Date`
 * object anywhere.
 *
 * That last point is the whole reason this module exists instead of a date
 * library: a coupon's validity is a DATE in the database and a `YYYY-MM-DD`
 * string in the contract, and `new Date("2026-11-01")` is UTC midnight, which
 * reads as 31 October on every device west of UTC. So the weekday is computed
 * arithmetically and every comparison is a string comparison, which is exact
 * for zero-padded ISO dates.
 */

export type CalendarMonth = {
  year: number;
  /** 1-12, as a human writes it, not as `Date` numbers it. */
  month: number;
};

/** A validity window while it is being chosen; `to` is null until it closes. */
export type DateRange = {
  from: string | null;
  to: string | null;
};

export type RangePosition = "none" | "start" | "inside" | "end" | "single";

export const MONTH_NAMES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** The week starts on Monday, which is how a Spanish calendar is read. */
export const WEEKDAY_LABELS_ES = ["L", "M", "M", "J", "V", "S", "D"] as const;

/** Six rows is what the longest month needs, and a fixed height never jumps. */
export const CALENDAR_WEEKS = 6;

const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `2026, 1, 5` → `2026-01-05`, zero-padded so string order is date order. */
export function toDateOnly(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

/** The month a stored date belongs to, or null when it is not a real date. */
export function monthOf(value: string | null | undefined): CalendarMonth | null {
  const parts = parseDateOnly(value);
  if (!parts) return null;
  return { year: parts.year, month: parts.month };
}

export function shiftMonth(month: CalendarMonth, delta: number): CalendarMonth {
  // Months counted from year zero, so the year carries itself.
  const total = month.year * 12 + (month.month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function monthLabel(month: CalendarMonth): string {
  return `${MONTH_NAMES_ES[month.month - 1]} ${month.year}`;
}

/**
 * Sakamoto's algorithm: the weekday of a civil date from plain arithmetic.
 * 0 is Monday here, because the grid's first column is Monday.
 */
export function dayOfWeekMondayFirst(
  year: number,
  month: number,
  day: number,
): number {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const adjusted = month < 3 ? year - 1 : year;
  const sunday =
    (adjusted +
      Math.floor(adjusted / 4) -
      Math.floor(adjusted / 100) +
      Math.floor(adjusted / 400) +
      (offsets[month - 1] ?? 0) +
      day) %
    7;
  return (sunday + 6) % 7;
}

/**
 * One month as six rows of seven cells. A cell is the day's own date-only
 * string, or null where the month has not started or has already ended — the
 * grid never borrows a neighbouring month's day, so a tap can only ever land
 * on a day of the month on screen.
 */
export function monthGrid(month: CalendarMonth): (string | null)[][] {
  const lead = dayOfWeekMondayFirst(month.year, month.month, 1);
  const total = daysInMonth(month.year, month.month);

  const weeks: (string | null)[][] = [];
  let day = 1 - lead;
  for (let week = 0; week < CALENDAR_WEEKS; week += 1) {
    const row: (string | null)[] = [];
    for (let column = 0; column < 7; column += 1) {
      row.push(
        day >= 1 && day <= total
          ? toDateOnly(month.year, month.month, day)
          : null,
      );
      day += 1;
    }
    weeks.push(row);
  }
  return weeks;
}

/**
 * Whether `day` falls before `minimum`. Null means there is no minimum at all,
 * which is how EDITING works: a coupon whose `validFrom` is already in the
 * past must keep that date, so nothing is disabled and nothing is rewritten
 * (S13).
 */
export function isDayBefore(
  day: string,
  minimum: string | null | undefined,
): boolean {
  if (!minimum) return false;
  return day < minimum;
}

/**
 * The whole from/to rule in one function (S13):
 *
 * - nothing chosen yet → the tap sets the START;
 * - a start without an end → the tap sets the END, including on the start
 *   itself, which is a legitimate one-day window (`from <= to`, S6);
 * - a tap BEFORE the start → the range restarts there, because the tendero is
 *   choosing an earlier beginning, not an impossible end;
 * - a closed window → the tap starts a new one.
 *
 * Dates are compared as strings, so December beats November even though 1 is
 * smaller than 28.
 */
export function selectRangeDay(range: DateRange, day: string): DateRange {
  if (!range.from || range.to) return { from: day, to: null };
  if (day < range.from) return { from: day, to: null };
  return { from: range.from, to: day };
}

/** Where a day sits in the chosen window, which is what the grid paints. */
export function rangePositionOf(range: DateRange, day: string): RangePosition {
  if (!range.from) return "none";
  if (!range.to) return day === range.from ? "single" : "none";
  if (range.from === range.to) return day === range.from ? "single" : "none";
  if (day === range.from) return "start";
  if (day === range.to) return "end";
  return day > range.from && day < range.to ? "inside" : "none";
}
