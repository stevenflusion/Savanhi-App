import type { CouponType } from "@repo/api-contracts";

import type { CategoryIconName } from "./category-icons";

/**
 * The icon a coupon's TYPE is drawn with.
 *
 * It exists because a metrics row is not a coupon: `CouponMetrics` carries the
 * title, the type and the funnel and nothing about the coupon's products (S9),
 * so the category icon `CouponCard` draws is simply not available there. The
 * type is, and it is the one visual the row can show honestly — never one
 * derived from an id (S11).
 *
 * The record is exhaustive over `CouponType`, so a fifth type would stop
 * compiling here instead of silently rendering nothing. Every name was taken
 * from the installed MaterialCommunityIcons glyphmap; no dependency is added
 * (S10).
 */
export const COUPON_TYPE_ICONS: Record<CouponType, CategoryIconName> = {
  free_text: "ticket-outline",
  combo: "numeric-2-box-multiple-outline",
  percentage: "sale",
  fixed_amount: "cash",
};

export function couponTypeIcon(type: CouponType): CategoryIconName {
  return COUPON_TYPE_ICONS[type];
}
