process.env.TZ = "America/Bogota";

import {
  MONTH_NAMES_ES,
  WEEKDAY_LABELS_ES,
  dayOfWeekMondayFirst,
  daysInMonth,
  isDayBefore,
  monthGrid,
  monthLabel,
  monthOf,
  rangePositionOf,
  selectRangeDay,
  shiftMonth,
  toDateOnly,
} from "@/src/features/coupons/domain/calendar";
import { todayDateOnly } from "@/src/lib/date-only";

describe("calendar month arithmetic", () => {
  it("names the twelve months in Spanish and the week from Monday", () => {
    expect(MONTH_NAMES_ES).toHaveLength(12);
    expect(MONTH_NAMES_ES[0]).toBe("enero");
    expect(MONTH_NAMES_ES[11]).toBe("diciembre");
    expect(WEEKDAY_LABELS_ES).toEqual(["L", "M", "M", "J", "V", "S", "D"]);
  });

  it("labels a month with its Spanish name and its year", () => {
    expect(monthLabel({ year: 2026, month: 11 })).toBe("noviembre 2026");
    expect(monthLabel({ year: 2024, month: 2 })).toBe("febrero 2024");
  });

  it("crosses the year boundary in both directions", () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    });
    expect(shiftMonth({ year: 2026, month: 6 }, 0)).toEqual({
      year: 2026,
      month: 6,
    });
  });

  it("counts February correctly on leap years and on century years", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("pads every part of a date-only string", () => {
    expect(toDateOnly(2026, 1, 5)).toBe("2026-01-05");
    expect(toDateOnly(2026, 11, 30)).toBe("2026-11-30");
  });

  it("reads the month a stored date belongs to, and nothing from a bad one", () => {
    expect(monthOf("2026-02-29")).toBeNull();
    expect(monthOf("2024-02-29")).toEqual({ year: 2024, month: 2 });
    expect(monthOf("")).toBeNull();
    expect(monthOf("2026-11-03T10:00:00Z")).toBeNull();
  });

  it("places the weekday with Monday first and no Date at all", () => {
    // 1 Nov 2026 is a Sunday, so it is the LAST column of a Monday-first week.
    expect(dayOfWeekMondayFirst(2026, 11, 1)).toBe(6);
    // 2 Nov 2026 is a Monday.
    expect(dayOfWeekMondayFirst(2026, 11, 2)).toBe(0);
    // 29 Feb 2024 is a Thursday.
    expect(dayOfWeekMondayFirst(2024, 2, 29)).toBe(3);
  });
});

describe("month grid", () => {
  it("lays a month out in six rows of seven with leading and trailing blanks", () => {
    const grid = monthGrid({ year: 2026, month: 11 });

    expect(grid).toHaveLength(6);
    for (const week of grid) expect(week).toHaveLength(7);

    // November 2026 starts on a Sunday: six blanks, then the 1st.
    expect(grid[0]).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      "2026-11-01",
    ]);
    expect(grid[1]?.[0]).toBe("2026-11-02");
    expect(grid[5]?.[6]).toBeNull();
  });

  it("holds exactly the days of the month and no neighbour's day", () => {
    const days = monthGrid({ year: 2024, month: 2 })
      .flat()
      .filter((day): day is string => day !== null);

    expect(days).toHaveLength(29);
    expect(days[0]).toBe("2024-02-01");
    expect(days[28]).toBe("2024-02-29");
    expect(days.every((day) => day.startsWith("2024-02-"))).toBe(true);
  });

  it("lays out a month that starts on a Monday with no leading blank", () => {
    const grid = monthGrid({ year: 2026, month: 6 });
    expect(grid[0]?.[0]).toBe("2026-06-01");
  });
});

describe("range selection", () => {
  const empty = { from: null, to: null };

  it("sets the start on the first tap", () => {
    expect(selectRangeDay(empty, "2026-11-10")).toEqual({
      from: "2026-11-10",
      to: null,
    });
  });

  it("sets the end on the second tap", () => {
    expect(
      selectRangeDay({ from: "2026-11-10", to: null }, "2026-11-14"),
    ).toEqual({ from: "2026-11-10", to: "2026-11-14" });
  });

  it("closes a one-day window when both taps land on the same day", () => {
    expect(
      selectRangeDay({ from: "2026-11-10", to: null }, "2026-11-10"),
    ).toEqual({ from: "2026-11-10", to: "2026-11-10" });
  });

  it("restarts the range when the second tap lands before the start", () => {
    expect(
      selectRangeDay({ from: "2026-11-10", to: null }, "2026-11-04"),
    ).toEqual({ from: "2026-11-04", to: null });
  });

  it("restarts the range once a window is already closed", () => {
    expect(
      selectRangeDay({ from: "2026-11-10", to: "2026-11-14" }, "2026-11-20"),
    ).toEqual({ from: "2026-11-20", to: null });
  });

  it("restarts across a month boundary without comparing day numbers", () => {
    // 1 Dec is AFTER 28 Nov even though 1 < 28, and 30 Oct is before it.
    expect(
      selectRangeDay({ from: "2026-11-28", to: null }, "2026-12-01"),
    ).toEqual({ from: "2026-11-28", to: "2026-12-01" });
    expect(
      selectRangeDay({ from: "2026-11-28", to: null }, "2026-10-30"),
    ).toEqual({ from: "2026-10-30", to: null });
  });

  it("reports where a day sits in the selected window", () => {
    const range = { from: "2026-11-10", to: "2026-11-14" };
    expect(rangePositionOf(range, "2026-11-10")).toBe("start");
    expect(rangePositionOf(range, "2026-11-14")).toBe("end");
    expect(rangePositionOf(range, "2026-11-12")).toBe("inside");
    expect(rangePositionOf(range, "2026-11-15")).toBe("none");
    expect(rangePositionOf(range, "2026-11-09")).toBe("none");
  });

  it("reports a one-day window as a single day, not as a start", () => {
    expect(
      rangePositionOf({ from: "2026-11-10", to: "2026-11-10" }, "2026-11-10"),
    ).toBe("single");
  });

  it("marks an open start before the window is closed", () => {
    expect(
      rangePositionOf({ from: "2026-11-10", to: null }, "2026-11-10"),
    ).toBe("single");
    expect(
      rangePositionOf({ from: "2026-11-10", to: null }, "2026-11-11"),
    ).toBe("none");
  });
});

describe("disabled days", () => {
  it("compares date-only strings and never a day number", () => {
    expect(isDayBefore("2026-11-02", "2026-11-03")).toBe(true);
    expect(isDayBefore("2026-11-03", "2026-11-03")).toBe(false);
    expect(isDayBefore("2026-12-01", "2026-11-30")).toBe(false);
    expect(isDayBefore("2025-12-31", "2026-01-01")).toBe(true);
  });

  it("disables nothing when there is no minimum, which is how editing works", () => {
    expect(isDayBefore("2020-01-01", null)).toBe(false);
  });
});

describe("today", () => {
  it("reads the device's own calendar day with no UTC shift", () => {
    const now = new Date();
    const expected = [
      String(now.getFullYear()).padStart(4, "0"),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");

    expect(todayDateOnly()).toBe(expected);
  });

  it("is a usable date-only string in the grid's own vocabulary", () => {
    const today = todayDateOnly();
    expect(monthOf(today)).not.toBeNull();
    expect(monthGrid(monthOf(today)!).flat()).toContain(today);
  });
});
