/**
 * The device timezone is set BEFORE anything reads a date, and it is set to the
 * coupon calendar zone the backend documents (`America/Bogota`, UTC-5). That is
 * not decoration: `new Date("2026-01-01")` is UTC midnight, so west of UTC it
 * reads as the previous day. The naive assertion below proves the shift is real
 * in this run, which is what makes the helper's stability meaningful instead of
 * vacuous.
 */
process.env.TZ = "America/Bogota";

import {
  DATE_ONLY_FALLBACK,
  formatDateOnly,
  formatDateOnlyRange,
  isDateOnly,
} from "@/src/lib/date-only";

const TIME_PATTERN = /\d{1,2}:\d{2}/;

describe("formatDateOnly", () => {
  it("renders a date-only string as day, short month and year in Spanish", () => {
    expect(formatDateOnly("2026-01-01")).toBe("1 ene 2026");
    expect(formatDateOnly("2026-02-28")).toBe("28 feb 2026");
    expect(formatDateOnly("2026-03-09")).toBe("9 mar 2026");
    expect(formatDateOnly("2026-11-03")).toBe("3 nov 2026");
    expect(formatDateOnly("2026-12-31")).toBe("31 dic 2026");
  });

  it("covers the twelve Spanish month abbreviations", () => {
    expect(
      [
        "01",
        "02",
        "03",
        "04",
        "05",
        "06",
        "07",
        "08",
        "09",
        "10",
        "11",
        "12",
      ].map((month) => formatDateOnly(`2026-${month}-15`)),
    ).toEqual([
      "15 ene 2026",
      "15 feb 2026",
      "15 mar 2026",
      "15 abr 2026",
      "15 may 2026",
      "15 jun 2026",
      "15 jul 2026",
      "15 ago 2026",
      "15 sep 2026",
      "15 oct 2026",
      "15 nov 2026",
      "15 dic 2026",
    ]);
  });

  /**
   * S11 — the shared formatter must never emit a clock time. Asserted over
   * every month plus the two boundary days, not over one sample.
   */
  it("never emits hours, minutes or seconds", () => {
    const rendered = [
      ...Array.from({ length: 12 }, (_, index) =>
        formatDateOnly(`2026-${String(index + 1).padStart(2, "0")}-01`),
      ),
      formatDateOnly("2026-12-31"),
      formatDateOnlyRange("2026-01-01", "2026-12-31"),
      formatDateOnly("not a date"),
    ].join(" | ");

    expect(rendered).not.toMatch(TIME_PATTERN);
    expect(rendered).not.toMatch(/\bT\d/);
    expect(rendered).not.toMatch(/GMT|UTC|[+-]\d{2}:\d{2}/);
  });

  /**
   * The timezone boundary. `2026-01-01` is the worst case: parsed as UTC
   * midnight it lands on 2025-12-31 in any zone west of UTC, which is where
   * both this app's users and its documented calendar zone live.
   */
  it("does not shift a YYYY-MM-DD value across the device timezone", () => {
    const naive = new Date("2026-01-01");
    // Proves the shift this helper has to avoid is actually happening here.
    expect(naive.getDate()).toBe(31);
    expect(naive.getMonth()).toBe(11);
    expect(naive.getFullYear()).toBe(2025);

    expect(formatDateOnly("2026-01-01")).toBe("1 ene 2026");
    expect(formatDateOnly("2025-12-31")).toBe("31 dic 2025");
    expect(formatDateOnlyRange("2026-01-01", "2026-01-01")).toBe(
      "1 ene 2026 - 1 ene 2026",
    );
  });

  it("falls back instead of rendering a datetime or an impossible date", () => {
    expect(formatDateOnly("2026-11-03T00:00:00Z")).toBe(DATE_ONLY_FALLBACK);
    expect(formatDateOnly("2026-11-03 10:30")).toBe(DATE_ONLY_FALLBACK);
    expect(formatDateOnly("2026-13-01")).toBe(DATE_ONLY_FALLBACK);
    expect(formatDateOnly("2026-00-10")).toBe(DATE_ONLY_FALLBACK);
    expect(formatDateOnly("2026-11-32")).toBe(DATE_ONLY_FALLBACK);
    expect(formatDateOnly("2026-11-00")).toBe(DATE_ONLY_FALLBACK);
    expect(formatDateOnly("2026-2-3")).toBe(DATE_ONLY_FALLBACK);
    expect(formatDateOnly("")).toBe(DATE_ONLY_FALLBACK);
    expect(formatDateOnly(null)).toBe(DATE_ONLY_FALLBACK);
    expect(formatDateOnly(undefined)).toBe(DATE_ONLY_FALLBACK);
  });

  it("accepts a caller-supplied fallback for an absent date", () => {
    expect(formatDateOnly(null, "Sin vigencia")).toBe("Sin vigencia");
  });
});

describe("formatDateOnlyRange", () => {
  it("joins both ends with a single separator", () => {
    expect(formatDateOnlyRange("2026-01-05", "2026-02-10")).toBe(
      "5 ene 2026 - 10 feb 2026",
    );
  });

  it("falls back as a whole when either end is unusable", () => {
    expect(formatDateOnlyRange("2026-01-05", "nope")).toBe(DATE_ONLY_FALLBACK);
    expect(formatDateOnlyRange("nope", "2026-01-05")).toBe(DATE_ONLY_FALLBACK);
    expect(formatDateOnlyRange(null, null)).toBe(DATE_ONLY_FALLBACK);
  });
});

describe("isDateOnly", () => {
  it("accepts only a well-formed calendar date with no time at all", () => {
    expect(isDateOnly("2026-11-03")).toBe(true);
    expect(isDateOnly("2026-11-03T00:00:00Z")).toBe(false);
    expect(isDateOnly("2026-11-3")).toBe(false);
    expect(isDateOnly("20261103")).toBe(false);
    expect(isDateOnly("")).toBe(false);
    expect(isDateOnly(null)).toBe(false);
  });

  /**
   * A real calendar check, not just a 1..31 range: the tendero types these
   * dates into the coupon form, and `z.iso.date()` on the backend rejects a
   * day the month does not have, so the form must reject it first.
   */
  it("rejects a day the month does not have, leap year included", () => {
    expect(isDateOnly("2024-02-29")).toBe(true);
    expect(isDateOnly("2026-02-29")).toBe(false);
    expect(isDateOnly("2000-02-29")).toBe(true);
    expect(isDateOnly("1900-02-29")).toBe(false);
    expect(isDateOnly("2026-04-31")).toBe(false);
    expect(isDateOnly("2026-02-30")).toBe(false);
  });
});
