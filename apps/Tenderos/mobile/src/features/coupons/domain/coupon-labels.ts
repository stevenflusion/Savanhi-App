import type { Coupon, CouponType } from "@repo/api-contracts";

/**
 * Every piece of Spanish copy a coupon renders with. It lives in one module so
 * the list, the editor and the cards cannot describe the same coupon in two
 * different ways.
 *
 * Nothing here ever reads an id or a timestamp (S11): a coupon carries no
 * creation time at all, and its validity is date-only.
 */
export const COUPON_TYPE_LABELS: Record<CouponType, string> = {
  free_text: "Texto libre",
  combo: "2x1 / Combo",
  percentage: "% de descuento",
  fixed_amount: "Monto fijo",
};

export function couponTypeLabel(type: CouponType): string {
  return COUPON_TYPE_LABELS[type];
}

/**
 * The four types in the order the editor offers them.
 *
 * `@repo/api-contracts` is ESM-only and Jest/Metro resolve CommonJS, so the
 * closed set cannot be imported as the runtime value `COUPON_TYPES` and is
 * restated here. The check below makes the restatement safe: adding a value to
 * `CouponType` without adding it here stops compiling.
 */
export const COUPON_TYPE_ORDER = [
  "free_text",
  "percentage",
  "fixed_amount",
  "combo",
] as const;

type MissingCouponType = Exclude<
  CouponType,
  (typeof COUPON_TYPE_ORDER)[number]
>;
const _everyCouponTypeIsOffered: MissingCouponType extends never ? true : never =
  true;
void _everyCouponTypeIsOffered;

/**
 * S5 — `2x1` and `combo` are the same type value and the product count decides
 * which one a coupon behaves as: one product is a 2x1, two or more a combo.
 * Null when nothing is selected yet, because an empty combo is not a shape.
 */
export function comboShapeLabel(productCount: number): string | null {
  if (productCount < 1) return null;
  return productCount === 1 ? "2x1" : "Combo";
}

/** What the editor tells the tendero about the chosen type's product count. */
export function productCardinalityHint(type: CouponType): string {
  return type === "combo"
    ? "Elige 1 producto para un 2x1, o 2 o más para un combo."
    : "Elige exactamente 1 producto.";
}

/**
 * The value field of the coupon's OWN type (S4), as a card shows it. A coupon
 * whose value is missing falls back to the type name instead of rendering an
 * empty chip.
 */
export function couponValueLabel(coupon: Coupon): string {
  switch (coupon.type) {
    case "free_text":
      return coupon.freeText?.trim() || COUPON_TYPE_LABELS.free_text;
    case "percentage":
      return coupon.percentageValue === null
        ? COUPON_TYPE_LABELS.percentage
        : `${coupon.percentageValue}% de descuento`;
    case "fixed_amount":
      return coupon.fixedAmountValue === null
        ? COUPON_TYPE_LABELS.fixed_amount
        : `$${coupon.fixedAmountValue.toFixed(2)} de descuento`;
    case "combo": {
      const count = coupon.products.length;
      if (count < 1) return COUPON_TYPE_LABELS.combo;
      return count === 1 ? "2x1" : `Combo de ${count} productos`;
    }
  }
}

/**
 * The claim funnel of one coupon, in the two numbers the tendero acts on: how
 * many customers took it and how many are left. `remainingStock` is already
 * derived by the backend from the reservation counter (S8).
 */
export function couponStockLabel(coupon: Coupon): string {
  const remaining =
    coupon.remainingStock > 0 ? `${coupon.remainingStock} disponibles` : "agotado";
  return `${coupon.claimedCount} reclamados · ${remaining}`;
}
