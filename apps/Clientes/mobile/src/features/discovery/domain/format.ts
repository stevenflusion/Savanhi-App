import type { Coupon, CustomerFeedStore } from "@repo/api-contracts";

import { DISCOVERY_COPY } from "./copy";

const MONTHS = [
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
];

/** Whole metres below one kilometre, kilometres with one decimal from there. */
export function formatDistance(
  store: Pick<CustomerFeedStore, "distanceMeters" | "distanceKm">,
): string {
  const meters = store.distanceMeters;
  if (typeof meters !== "number" || !Number.isFinite(meters)) {
    return DISCOVERY_COPY.noDistance;
  }
  const rounded = Math.round(meters);
  if (rounded < 1000) return `A ${rounded} m`;
  return `A ${Math.round(meters / 100) / 10} km`;
}

/**
 * Formats a date-only `YYYY-MM-DD` value by reading its parts. It never builds
 * a `Date`, so no timezone can shift the day (S11), and anything that is not a
 * real calendar date is refused rather than guessed.
 */
export function formatDateOnly(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;

  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > lengths[month - 1]!) return null;

  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function formatValidity(validFrom: string, validTo: string) {
  const from = formatDateOnly(validFrom);
  const to = formatDateOnly(validTo);
  return from && to ? `${from} – ${to}` : null;
}

/**
 * The benefit as the coupon's own value fields state it (exactly one is set).
 * A coupon with none of them yields nothing instead of an invented promotion.
 */
export function describeBenefit(
  coupon: Pick<Coupon, "freeText" | "percentageValue" | "fixedAmountValue">,
): string | null {
  if (coupon.percentageValue !== null) return `${coupon.percentageValue}%`;
  if (coupon.fixedAmountValue !== null) {
    return `$${coupon.fixedAmountValue.toFixed(2)}`;
  }
  return coupon.freeText?.trim() ? coupon.freeText : null;
}
