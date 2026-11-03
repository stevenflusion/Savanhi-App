import type {
  CouponRedemptionHistoryPage,
  StoreMetrics,
} from "@repo/api-contracts";

import type { AuthenticatedJsonRequest } from "@/src/features/auth/infrastructure/store-photos-fetch-repository";

import { createCouponJsonReader } from "./coupon-json";
import { createCouponsFetchRepository } from "./coupons-fetch-repository";
import type { StoreMetricsRepository } from "../application/ports/store-metrics-repository";

/** The Spanish wording of each read when the API says something new. */
const FALLBACK = {
  metrics: "No se pudieron cargar los datos de tu tienda.",
  history: "No se pudo cargar el historial de canjes.",
} as const;

/**
 * How many redemptions the metrics summary carries inline, mirroring
 * `STORE_METRICS_RECENT_REDEMPTIONS` in `@repo/api-contracts`.
 *
 * It is restated rather than imported for the reason T8 recorded: the
 * contracts package is ESM-only and Jest/Metro resolve CommonJS, so mobile
 * imports it for TYPES only. The number matters here because it is what tells
 * the screen whether a full preview might have more behind it.
 */
export const STORE_METRICS_RECENT_REDEMPTIONS = 5;

/**
 * How many entries one "load more" asks for, mirroring
 * `REDEMPTION_HISTORY_DEFAULT_LIMIT`. It must stay at or under
 * `REDEMPTION_HISTORY_MAX_LIMIT` (100): T7 REJECTS a larger window with a 400
 * rather than clamping it, so a drift here is a visible failure and never a
 * silently short page.
 */
export const REDEMPTION_HISTORY_PAGE_SIZE = 20;

export function createStoreMetricsFetchRepository(
  request: AuthenticatedJsonRequest,
): StoreMetricsRepository {
  const { readData } = createCouponJsonReader(request);
  // Reuse, not duplication: the home tab resolves "your store" through the
  // very method the coupon workspace uses, so the two cannot pick different
  // stores or word the same failure differently.
  const { listOwnStores } = createCouponsFetchRepository(request);

  return {
    listOwnStores,

    readStoreMetrics: (storeId) =>
      readData<StoreMetrics>(
        `/api/v1/tenderos/stores/${storeId}/metrics`,
        FALLBACK.metrics,
      ),

    /**
     * The query carries `limit` and `offset` and NOTHING else:
     * `redemptionHistoryQuerySchema` is a strict object, so any extra
     * parameter — a filter, a cache buster — is a 400 and not an ignored hint.
     * Both values are numbers, so the string is built directly instead of
     * through a URL encoder that React Native only partly polyfills.
     */
    readRedemptionHistory: (storeId, window) =>
      readData<CouponRedemptionHistoryPage>(
        `/api/v1/tenderos/stores/${storeId}/redemptions?limit=${window.limit}&offset=${window.offset}`,
        FALLBACK.history,
      ),
  };
}
