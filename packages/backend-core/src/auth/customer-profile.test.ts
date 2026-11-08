import assert from "node:assert/strict";
import test from "node:test";
import {
  ageOn,
  evaluateCustomerEligibility,
  parseBirthDate,
} from "./customer-profile.js";

/**
 * C8/C9: the birth date is a date-only string handled by arithmetic on its
 * three parts. These cases pin the calendar rules that no device timezone can
 * move, because no `Date` is ever built from the stored value (S11).
 */
test("parseBirthDate accepts only a real calendar date written YYYY-MM-DD", () => {
  assert.deepEqual(parseBirthDate("2002-11-04"), {
    year: 2002,
    month: 11,
    day: 4,
  });
  assert.deepEqual(parseBirthDate("2000-02-29"), {
    year: 2000,
    month: 2,
    day: 29,
  });
  assert.deepEqual(parseBirthDate("2024-02-29"), {
    year: 2024,
    month: 2,
    day: 29,
  });

  for (const invalid of [
    "",
    " 2002-11-04",
    "2002-11-04 ",
    "2002-11-04T00:00:00Z",
    "04/11/2002",
    "04-11-2002",
    "2002-4-11",
    "2002-11-4",
    "02002-11-04",
    "2002-13-01",
    "2002-00-10",
    "2002-11-00",
    "2002-11-31",
    "2002-02-30",
    "2023-02-29",
    "1900-02-29",
    "0000-01-01",
    "2002-11-04\n",
    "２００２-11-04",
  ]) {
    assert.equal(parseBirthDate(invalid), null, JSON.stringify(invalid));
  }
});

test("parseBirthDate imposes no minimum year beyond a positive canonical one", () => {
  // The only year limit is the one the format itself needs: four digits, and
  // a positive year. No product rule bounds how old a birth date may be.
  assert.deepEqual(parseBirthDate("1899-12-31"), {
    year: 1899,
    month: 12,
    day: 31,
  });
  assert.deepEqual(parseBirthDate("1850-06-15"), {
    year: 1850,
    month: 6,
    day: 15,
  });
  assert.deepEqual(parseBirthDate("0001-01-01"), {
    year: 1,
    month: 1,
    day: 1,
  });
  // A real-calendar rejection still holds in those years: 1700 is not leap.
  assert.equal(parseBirthDate("1700-02-29"), null);
  assert.deepEqual(parseBirthDate("1600-02-29"), {
    year: 1600,
    month: 2,
    day: 29,
  });
});

test("ageOn counts completed years on the given calendar day", () => {
  assert.equal(ageOn("2008-11-08", "2026-11-08"), 18);
  assert.equal(ageOn("2008-11-09", "2026-11-08"), 17);
  assert.equal(ageOn("2008-11-07", "2026-11-08"), 18);
  assert.equal(ageOn("2008-12-01", "2026-11-08"), 17);
  assert.equal(ageOn("2002-11-04", "2026-11-08"), 24);
  // Year boundary: born on the last day of the year.
  assert.equal(ageOn("2007-12-31", "2026-01-01"), 18);
  assert.equal(ageOn("2008-01-01", "2025-12-31"), 17);
});

// APPROVED by the user (selection "1 de marzo", odd/tasks/clientes-app.md L7):
// in a common year a 29 February birthday is reached on 1 March, so a customer
// born on 29 February is still 17 on 28 February of their 18th-birthday year.
test("a 29 February birthday is reached on 1 March in a common year", () => {
  assert.equal(ageOn("2008-02-29", "2026-02-28"), 17);
  assert.equal(ageOn("2008-02-29", "2026-03-01"), 18);
  assert.equal(ageOn("2008-02-29", "2028-02-29"), 20);
});

test("a 29 February birth date turns eligible on 1 March, not on 28 February", () => {
  assert.equal(
    evaluateCustomerEligibility("2008-02-29", "2026-02-28"),
    "underage",
  );
  assert.equal(
    evaluateCustomerEligibility("2008-02-29", "2026-03-01"),
    "eligible",
  );
});

test("a birth date in the future is a negative age, never adult", () => {
  assert.equal(ageOn("2026-11-09", "2026-11-08"), -1);
  assert.equal(
    evaluateCustomerEligibility("2026-11-09", "2026-11-08"),
    "underage",
  );
});

test("eligibility is 18 inclusive on the 18th birthday", () => {
  assert.equal(
    evaluateCustomerEligibility("2008-11-08", "2026-11-08"),
    "eligible",
  );
  assert.equal(
    evaluateCustomerEligibility("2008-11-09", "2026-11-08"),
    "underage",
  );
  assert.equal(
    evaluateCustomerEligibility(null, "2026-11-08"),
    "birth_date_required",
  );
});
