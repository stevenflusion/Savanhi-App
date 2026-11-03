import type { CouponRedemption } from "@repo/api-contracts";

import type { CouponsResult } from "./coupons-repository";

/**
 * The two calls the scanner makes (T6), and no third one: there is no way to
 * un-redeem a claim and no way to read someone else's.
 *
 * `previewRedemption` answers what the scanned code WOULD redeem and writes
 * nothing, so the tendero sees the coupon and the customer before committing;
 * `redeemCoupon` is the transition itself and happens exactly once per claim.
 *
 * Both take the scanned token as a value and never store it: the token is a
 * bearer secret, so it lives only in the request that carries it.
 */
export type CouponRedemptionsRepository = {
  previewRedemption: (
    qrToken: string,
  ) => Promise<CouponsResult<CouponRedemption>>;
  redeemCoupon: (qrToken: string) => Promise<CouponsResult<CouponRedemption>>;
};
