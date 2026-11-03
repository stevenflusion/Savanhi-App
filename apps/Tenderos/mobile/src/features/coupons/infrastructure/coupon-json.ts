import type { AuthenticatedJsonRequest } from "@/src/features/auth/infrastructure/store-photos-fetch-repository";

import { toSpanishCouponError } from "../domain/coupon-errors";
import type { CouponsResult } from "../application/ports/coupons-repository";

/**
 * The ONE reader of the API's `{ data }` envelope for the coupon feature, used
 * by the coupon repository and by the scanner's redemption repository alike.
 *
 * It is a single module rather than a helper per repository so the two cannot
 * disagree on the three rules that matter: a backend message always becomes
 * Spanish through `toSpanishCouponError`, a body that cannot be parsed is a
 * FAILURE and never an empty success, and an envelope with no `data` is a
 * failure too — a screen would otherwise render "nothing here" for a response
 * it simply could not read.
 */
export function createCouponJsonReader(request: AuthenticatedJsonRequest) {
  const readData = async <T>(
    path: string,
    fallback: string,
    init?: RequestInit,
  ): Promise<CouponsResult<T>> => {
    const outcome = await request(path, init);
    if (!outcome.success) {
      return {
        success: false,
        error: toSpanishCouponError(outcome.error, fallback),
      };
    }
    try {
      const body = (await outcome.response.json()) as { data?: T };
      if (body.data === undefined) return { success: false, error: fallback };
      return { success: true, data: body.data };
    } catch {
      return { success: false, error: fallback };
    }
  };

  const sendJson = <T>(
    path: string,
    method: "POST" | "PATCH" | "PUT",
    payload: unknown,
    fallback: string,
  ) =>
    readData<T>(path, fallback, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  return { readData, sendJson };
}
