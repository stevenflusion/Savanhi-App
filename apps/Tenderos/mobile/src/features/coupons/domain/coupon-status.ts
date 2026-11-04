import type { Coupon } from "@repo/api-contracts";

/**
 * Whether a coupon is still doing something, derived on read and never stored.
 *
 * The backend already takes this position for a claim (T5 derives `expired`
 * rather than persisting it), and the reason is the same here: S6 makes the
 * validity END DATE the hard limit, so "expired" is a fact about today and not
 * a state someone has to write. A nightly job that flips a column would be a
 * second source of truth that can disagree with the calendar.
 *
 * `Coupon` carries no `expired` flag, so the comparison is done here — on
 * date-only strings, which compare correctly with `<` because they are
 * zero-padded (S11).
 */
export function isCouponExpired(coupon: Coupon, today: string): boolean {
  return coupon.validTo < today;
}

/**
 * ACTIVE is what the Home carousel shows: not paused and not expired.
 *
 * Stock is deliberately NOT part of it. An exhausted coupon is still live —
 * the tendero can raise its stock and it keeps working — while a paused or an
 * expired one is not, and the card already says how many are left.
 */
export function isCouponActive(coupon: Coupon, today: string): boolean {
  return !coupon.paused && !isCouponExpired(coupon, today);
}

/** The store's active coupons, in the order the API returned them. */
export function selectActiveCoupons(
  coupons: Coupon[],
  today: string,
): Coupon[] {
  return coupons.filter((coupon) => isCouponActive(coupon, today));
}
