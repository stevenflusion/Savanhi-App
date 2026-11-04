import type {
  Coupon,
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
  /**
   * The store's coupons as the HOME CAROUSEL needs them (S14).
   *
   * The metrics summary deliberately carries only the funnel of each coupon
   * (`CouponMetrics` is the title, the type and the counts — T7 kept it that
   * narrow on purpose), and a card has to know the coupon's photo, its product
   * categories, its paused flag and its validity end date to decide whether it
   * is ACTIVE and what to draw. Those live on `Coupon`, so the carousel reads
   * the coupon list the workspace already reads — the same method, not a
   * second one.
   */
  listStoreCoupons: (storeId: string) => Promise<CouponsResult<Coupon[]>>;
  /**
   * Pause and activate, for the coupon DETAIL screen. It is the coupons
   * repository's own method re-exported, not a second write path: the
   * workspace list and the detail must hit the same two routes and word the
   * same failure the same way.
   */
  setCouponPaused: (
    couponId: string,
    paused: boolean,
  ) => Promise<CouponsResult<Coupon>>;
  /** The whole tab in ONE request: totals, per-coupon funnel, followers. */
  readStoreMetrics: (storeId: string) => Promise<CouponsResult<StoreMetrics>>;
  /** The paged history, for the redemptions the summary did not carry. */
  readRedemptionHistory: (
    storeId: string,
    window: RedemptionHistoryWindow,
  ) => Promise<CouponsResult<CouponRedemptionHistoryPage>>;
};
