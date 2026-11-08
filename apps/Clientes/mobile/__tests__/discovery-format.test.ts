import type { Coupon } from "@repo/api-contracts";

import {
  describeBenefit,
  formatDateOnly,
  formatDistance,
  formatValidity,
} from "@/src/features/discovery/domain/format";

const store = (distanceMeters: number | null, distanceKm: number | null) => ({
  distanceMeters,
  distanceKm,
});

describe("formatDistance", () => {
  it("never turns a missing distance into 0 km", () => {
    expect(formatDistance(store(null, null))).toBe("Sin distancia");
    expect(formatDistance(store(null, 3))).toBe("Sin distancia");
  });

  it("shows whole metres below one kilometre", () => {
    expect(formatDistance(store(170, 0.17))).toBe("A 170 m");
    expect(formatDistance(store(169.6, 0.17))).toBe("A 170 m");
    expect(formatDistance(store(0, 0))).toBe("A 0 m");
    expect(formatDistance(store(999, 1))).toBe("A 999 m");
  });

  it("switches to kilometres, rounded to one decimal, from one kilometre", () => {
    expect(formatDistance(store(1000, 1))).toBe("A 1 km");
    expect(formatDistance(store(999.6, 1))).toBe("A 1 km");
    expect(formatDistance(store(1500, 1.5))).toBe("A 1.5 km");
    expect(formatDistance(store(12369, 12.37))).toBe("A 12.4 km");
  });
});

describe("formatDateOnly", () => {
  it("formats a date-only string without any time or timezone shift", () => {
    expect(formatDateOnly("2026-01-01")).toBe("1 ene 2026");
    expect(formatDateOnly("2026-11-25")).toBe("25 nov 2026");
    expect(formatDateOnly("2026-12-31")).toBe("31 dic 2026");
  });

  it("refuses anything that is not a real calendar date-only value", () => {
    expect(formatDateOnly("2026-02-31")).toBeNull();
    expect(formatDateOnly("2026-11-25T23:30:00-05:00")).toBeNull();
    expect(formatDateOnly("25/11/2026")).toBeNull();
    expect(formatDateOnly("")).toBeNull();
  });

  it("joins the validity window as a date range", () => {
    expect(formatValidity("2026-11-01", "2026-11-25")).toBe(
      "1 nov 2026 – 25 nov 2026",
    );
    expect(formatValidity("2026-11-01", "garbage")).toBeNull();
  });
});

type BenefitFields = Pick<
  Coupon,
  "freeText" | "percentageValue" | "fixedAmountValue"
>;
const fields = (o: Partial<BenefitFields>): BenefitFields => ({
  freeText: null,
  percentageValue: null,
  fixedAmountValue: null,
  ...o,
});

describe("describeBenefit", () => {
  it("reads the benefit only from the coupon's own value fields", () => {
    expect(describeBenefit(fields({ percentageValue: 15 }))).toBe("15%");
    expect(describeBenefit(fields({ percentageValue: 12.5 }))).toBe("12.5%");
    expect(describeBenefit(fields({ fixedAmountValue: 0.5 }))).toBe("$0.50");
    expect(describeBenefit(fields({ fixedAmountValue: 3 }))).toBe("$3.00");
    expect(describeBenefit(fields({ freeText: "Pan gratis" }))).toBe(
      "Pan gratis",
    );
  });

  it("invents nothing when no value field is present", () => {
    expect(describeBenefit(fields({}))).toBeNull();
  });
});
