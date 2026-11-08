/**
 * The birth date is date-only (S11). It is handled as three digit strings and
 * assembled into `YYYY-MM-DD` by hand: it never goes through `Date`, so no
 * timezone can shift it. Whether the person is 18 is decided by the server
 * (America/Bogota calendar day), never here.
 */
export type BirthDateSegment = "day" | "month" | "year";
export type BirthDateParts = Record<BirthDateSegment, string>;

export const EMPTY_BIRTH_DATE_PARTS: BirthDateParts = {
  day: "",
  month: "",
  year: "",
};

const SEGMENT_LENGTH: Record<BirthDateSegment, number> = {
  day: 2,
  month: 2,
  year: 4,
};

export type BirthDateResult =
  | { status: "ok"; value: string }
  | { status: "incomplete" }
  | { status: "invalid" };

export function sanitizeSegment(segment: BirthDateSegment, raw: string) {
  return raw.replace(/\D/g, "").slice(0, SEGMENT_LENGTH[segment]);
}

export function isSegmentComplete(segment: BirthDateSegment, value: string) {
  return value.length === SEGMENT_LENGTH[segment];
}

export function toBirthDateParts(birthDate: string | null): BirthDateParts {
  const match = birthDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate) : null;
  if (!match) return EMPTY_BIRTH_DATE_PARTS;
  const [, year = "", month = "", day = ""] = match;
  return { day, month, year };
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Checks only that the three parts form a real calendar date. Whether the
 * person is 18, or the date lies in the future, is the server's decision (it
 * reads the America/Bogota day); the phone clock is never consulted.
 */
export function parseBirthDate(parts: BirthDateParts): BirthDateResult {
  const complete = (Object.keys(SEGMENT_LENGTH) as BirthDateSegment[]).every(
    (segment) => isSegmentComplete(segment, parts[segment]),
  );
  if (!complete) return { status: "incomplete" };

  const day = Number(parts.day);
  const month = Number(parts.month);
  const year = Number(parts.year);
  if (year < 1 || month < 1 || month > 12) return { status: "invalid" };
  if (day < 1 || day > daysInMonth(year, month)) return { status: "invalid" };

  return { status: "ok", value: `${parts.year}-${parts.month}-${parts.day}` };
}
