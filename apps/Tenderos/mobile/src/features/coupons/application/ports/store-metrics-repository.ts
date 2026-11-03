import type {
  CouponRedemptionHistoryPage,
  StoreMetrics,
} from "@repo/api-contracts";

import type { CouponsResult, CouponStore } from "./coupons-repository";

/**
 * The window of one history page. It is exactly the two values T7's query
 * schema accepts, and the schema is STRICT — a third key is a 400 — so the
 * port cannot grow a filter the backend would reject.
 */
export type RedemptionHistoryWindow = {
  limit: number;
  offset: number;
};

/**
 * Everything the tendero's home tab reads (S9).
 *
 * `listOwnStores` is the SAME method the coupons repository exposes, not a
 * second store-reading path: the home tab and the coupon workspace must agree
 * on which store is "yours" and on the Spanish wording when that read fails.
 */
export type StoreMetricsRepository = {
  listOwnStores: () => Promise<CouponsResult<CouponStore[]>>;
  /** The whole tab in ONE request: totals, per-coupon funnel, followers. */
  readStoreMetrics: (storeId: string) => Promise<CouponsResult<StoreMetrics>>;
  /** The paged history, for the redemptions the summary did not carry. */
  readRedemptionHistory: (
    storeId: string,
    window: RedemptionHistoryWindow,
  ) => Promise<CouponsResult<CouponRedemptionHistoryPage>>;
};
