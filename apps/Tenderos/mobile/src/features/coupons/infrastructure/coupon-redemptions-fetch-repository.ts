import type { CouponRedemption } from "@repo/api-contracts";

import type { AuthenticatedJsonRequest } from "@/src/features/auth/infrastructure/store-photos-fetch-repository";

import { createCouponJsonReader } from "./coupon-json";
import type { CouponRedemptionsRepository } from "../application/ports/coupon-redemptions-repository";

/**
 * The Spanish wording of each call when the API says something this app's
 * error table has never seen. An English constraint sentence is worse for the
 * tendero than the action's own wording, and both fallbacks end in the only
 * instruction that is always safe at the counter: scan again.
 */
const FALLBACK = {
  preview: "No se pudo leer el código. Escanea de nuevo.",
  redeem: "No se pudo canjear el cupón. Escanea de nuevo.",
} as const;

const PREVIEW_PATH = "/api/v1/tenderos/coupon-redemptions/preview";
const REDEEM_PATH = "/api/v1/tenderos/coupon-redemptions";

/**
 * Both routes are POSTs carrying the token in the BODY, the preview included.
 * That is not an accident of symmetry: the token is a bearer secret and a path
 * or a query string ends up in access logs, so it never travels in the URL
 * (T6). Nothing here logs, stores or returns the token either.
 */
export function createCouponRedemptionsFetchRepository(
  request: AuthenticatedJsonRequest,
): CouponRedemptionsRepository {
  const { sendJson } = createCouponJsonReader(request);

  return {
    previewRedemption: (qrToken) =>
      sendJson<CouponRedemption>(
        PREVIEW_PATH,
        "POST",
        { qrToken },
        FALLBACK.preview,
      ),

    redeemCoupon: (qrToken) =>
      sendJson<CouponRedemption>(
        REDEEM_PATH,
        "POST",
        { qrToken },
        FALLBACK.redeem,
      ),
  };
}
