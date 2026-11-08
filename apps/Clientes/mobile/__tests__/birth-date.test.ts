import {
  EMPTY_BIRTH_DATE_PARTS,
  isSegmentComplete,
  parseBirthDate,
  sanitizeSegment,
  toBirthDateParts,
} from "@/src/features/auth/domain/birth-date";

const parts = (day: string, month: string, year: string) => ({
  day,
  month,
  year,
});

describe("birth date segments (C8)", () => {
  it("keeps only digits and caps each segment at its length", () => {
    expect(sanitizeSegment("day", "0a4")).toBe("04");
    expect(sanitizeSegment("day", "123")).toBe("12");
    expect(sanitizeSegment("month", " 1/1")).toBe("11");
    expect(sanitizeSegment("year", "20-02x9")).toBe("2002");
  });

  it("reports a segment as complete only at its full length", () => {
    expect(isSegmentComplete("day", "4")).toBe(false);
    expect(isSegmentComplete("day", "04")).toBe(true);
    expect(isSegmentComplete("month", "1")).toBe(false);
    expect(isSegmentComplete("month", "11")).toBe(true);
    expect(isSegmentComplete("year", "200")).toBe(false);
    expect(isSegmentComplete("year", "2002")).toBe(true);
  });

  it("splits a stored date-only value back into the three fields", () => {
    expect(toBirthDateParts("2002-11-04")).toEqual(parts("04", "11", "2002"));
    expect(toBirthDateParts(null)).toEqual(EMPTY_BIRTH_DATE_PARTS);
    expect(toBirthDateParts("not a date")).toEqual(EMPTY_BIRTH_DATE_PARTS);
  });
});

describe("birth date parsing (C8, S11)", () => {
  it("builds the canonical date-only string from day, month and year", () => {
    expect(parseBirthDate(parts("04", "11", "2002"))).toEqual({
      status: "ok",
      value: "2002-11-04",
    });
    expect(parseBirthDate(parts("31", "12", "1999"))).toEqual({
      status: "ok",
      value: "1999-12-31",
    });
  });

  it("gives the same answer in every timezone, with no Date round trip", () => {
    const originalTz = process.env.TZ;
    try {
      for (const tz of ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"]) {
        process.env.TZ = tz;
        expect(parseBirthDate(parts("01", "01", "2000"))).toEqual({
          status: "ok",
          value: "2000-01-01",
        });
        expect(parseBirthDate(parts("31", "12", "1999"))).toEqual({
          status: "ok",
          value: "1999-12-31",
        });
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it("is incomplete while any segment is empty or short", () => {
    for (const candidate of [
      parts("", "", ""),
      parts("4", "11", "2002"),
      parts("04", "1", "2002"),
      parts("04", "11", "200"),
      parts("04", "11", ""),
    ]) {
      expect(parseBirthDate(candidate)).toEqual({
        status: "incomplete",
      });
    }
  });

  it("rejects dates that are not real calendar dates", () => {
    for (const candidate of [
      parts("31", "02", "2002"),
      parts("29", "02", "2023"),
      parts("29", "02", "1900"),
      parts("00", "01", "2000"),
      parts("32", "01", "2000"),
      parts("01", "00", "2000"),
      parts("01", "13", "2000"),
      parts("31", "04", "2000"),
      parts("01", "01", "0000"),
    ]) {
      expect(parseBirthDate(candidate)).toEqual({ status: "invalid" });
    }
  });

  it("accepts real leap days and any real past year, with no 1900 floor", () => {
    expect(parseBirthDate(parts("29", "02", "2000"))).toEqual({
      status: "ok",
      value: "2000-02-29",
    });
    expect(parseBirthDate(parts("29", "02", "1600"))).toEqual({
      status: "ok",
      value: "1600-02-29",
    });
    expect(parseBirthDate(parts("15", "06", "1850"))).toEqual({
      status: "ok",
      value: "1850-06-15",
    });
    expect(parseBirthDate(parts("01", "01", "0001"))).toEqual({
      status: "ok",
      value: "0001-01-01",
    });
  });

  it("leaves future dates and every age rule to the server, never to the phone clock", () => {
    // Structurally valid dates are accepted whatever the device date is; the
    // server answers underage/future eligibility for them.
    for (const candidate of [
      parts("10", "11", "2099"),
      parts("08", "11", "2012"),
      parts("29", "02", "2008"),
    ]) {
      expect(parseBirthDate(candidate).status).toBe("ok");
    }
  });

  it("gives the same answer whatever the device clock says", () => {
    jest.useFakeTimers({ now: new Date(2001, 5, 1) });
    try {
      expect(parseBirthDate(parts("04", "11", "2002"))).toEqual({
        status: "ok",
        value: "2002-11-04",
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
