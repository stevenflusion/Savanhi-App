import {
  CUSTOMER_MINIMUM_AGE,
  type CustomerEligibility,
  type CustomerProfile,
  type CustomerProfileUpdateRequest,
} from "@repo/api-contracts/auth";
import { AppError } from "../errors.js";
import type { createUsersRepository } from "../database/repositories/users.repository.js";

/**
 * C8/C9: the customer's birth date and the 18+ rule that decides whether the
 * customer API may be used.
 *
 * A birth date is a date-only `YYYY-MM-DD` string (S11), so everything here is
 * arithmetic on its three parts. No `Date` is ever built from it: a device or
 * server timezone could otherwise move the day, and a birthday is exactly the
 * kind of value where one day is the whole answer. "Today" is not read from a
 * clock here either — it arrives from the database as the `America/Bogota`
 * calendar day, the same one coupon validity uses.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CalendarDate = { year: number; month: number; day: number };

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function toCalendarDate(value: string): CalendarDate | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Year 0000 is not a calendar year in the canonical form; nothing else
  // bounds how far back a date may go.
  if (year < 1) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/**
 * The parts of a real calendar date written exactly `YYYY-MM-DD`, or `null`.
 * Anything else — another separator, a missing zero, a time, a day the month
 * does not have, 29 February in a common year — is not a birth date.
 */
export function parseBirthDate(value: string): CalendarDate | null {
  return toCalendarDate(value);
}

/**
 * Completed years on `today`. A 29 February birthday is reached on 1 March in a
 * common year (approved by the user), which falls out of comparing (month,
 * day) pairs. Both arguments
 * come from a `date` column or from `parseBirthDate`, so an unparseable one is a
 * programming error, not user input.
 */
export function ageOn(birthDate: string, today: string): number {
  const born = toCalendarDate(birthDate);
  const now = toCalendarDate(today);
  if (!born || !now) throw new Error("ageOn needs two YYYY-MM-DD dates.");
  const birthdayReached =
    now.month > born.month || (now.month === born.month && now.day >= born.day);
  return now.year - born.year - (birthdayReached ? 0 : 1);
}

export function evaluateCustomerEligibility(
  birthDate: string | null,
  today: string,
): CustomerEligibility {
  if (birthDate === null) return "birth_date_required";
  return ageOn(birthDate, today) >= CUSTOMER_MINIMUM_AGE
    ? "eligible"
    : "underage";
}

const GATE_MESSAGES: Record<
  Exclude<CustomerEligibility, "eligible">,
  string
> = {
  birth_date_required: "Complete your profile to use Savanhi.",
  underage: "You must be at least 18 years old to use Savanhi.",
};

export function eligibilityError(
  eligibility: Exclude<CustomerEligibility, "eligible">,
  statusCode: number,
) {
  return new AppError(GATE_MESSAGES[eligibility], statusCode, {
    eligibility,
    minimumAge: CUSTOMER_MINIMUM_AGE,
  });
}

export function createCustomerProfileService(
  users: ReturnType<typeof createUsersRepository>,
) {
  async function read(
    userId: string,
  ): Promise<CustomerProfile & { today: string }> {
    const row = await users.readCustomerProfile(userId);
    if (!row) throw new AppError("User not found.", 404);
    return {
      fullName: row.fullName,
      birthDate: row.birthDate,
      eligibility: evaluateCustomerEligibility(row.birthDate, row.today),
      today: row.today,
    };
  }

  return {
    async get(userId: string): Promise<CustomerProfile> {
      const { today: _today, ...profile } = await read(userId);
      return profile;
    },

    /**
     * Guards every customer route except the profile itself. It answers 403 —
     * the person is known but may not use this yet — and carries the reason in
     * `details.eligibility`, which is what a client keys on; the message is
     * only for a human reading a log.
     */
    async requireEligible(userId: string): Promise<void> {
      const { eligibility } = await read(userId);
      if (eligibility !== "eligible") throw eligibilityError(eligibility, 403);
    },

    /**
     * Saves the name and the birth date together, or neither. An underage date
     * is refused with 422 — the payload is well formed, the rule is what fails —
     * before any statement writes, so the stored profile is left exactly as it
     * was. The write itself is the users repository's, which also advances a
     * client's `registrationStatus` exactly as saving a name does (C2).
     */
    async update(
      userId: string,
      payload: CustomerProfileUpdateRequest,
    ): Promise<CustomerProfile> {
      const { today } = await read(userId);
      if (ageOn(payload.birthDate, today) < CUSTOMER_MINIMUM_AGE) {
        throw eligibilityError("underage", 422);
      }
      const updated = await users.updateCustomerProfile(userId, payload);
      if (!updated) {
        throw new AppError("You do not have access to this resource.", 403);
      }
      const { today: _today, ...profile } = await read(userId);
      return profile;
    },
  };
}
