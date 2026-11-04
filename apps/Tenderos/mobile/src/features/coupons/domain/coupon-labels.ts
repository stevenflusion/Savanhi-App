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
 * What is left of a coupon's stock, in the one wording the whole app uses.
 * `remainingStock` is already derived by the backend from the reservation
 * counter (S8), so nothing recomputes it here.
 */
export function couponRemainingLabel(remainingStock: number): string {
  return remainingStock > 0 ? `${remainingStock} disponibles` : "agotado";
}

/**
 * The claim funnel of one coupon, in the two numbers the tendero acts on: how
 * many customers took it and how many are left.
 */
export function couponStockLabel(coupon: Coupon): string {
  return `${coupon.claimedCount} reclamados · ${couponRemainingLabel(coupon.remainingStock)}`;
}

/**
 * The OTHER funnel, the one the metrics tab shows (S9): claimed against
 * redeemed. An expired claim that was never redeemed still counts as claimed
 * and never as redeemed, which is a product rule the backend already applies
 * — this only words it.
 *
 * Both halves are pluralised, because the tendero reads `1 reclamado` far more
 * often than the plural on a coupon that is just starting.
 */
export function couponFunnelLabel(
  claimedCount: number,
  redeemedCount: number,
): string {
  const claimed = claimedCount === 1 ? "reclamado" : "reclamados";
  const redeemed = redeemedCount === 1 ? "canjeado" : "canjeados";
  return `${claimedCount} ${claimed} · ${redeemedCount} ${redeemed}`;
}

/**
 * The same value as `couponValueLabel`, written short enough to be the big
 * bold line of a card (S14).
 *
 * It is Spanish and symbolic rather than English: `-20%` and `-$2.00` are read
 * as a discount everywhere, while "20% OFF" would put English copy on a screen
 * whose every other word is Spanish. Free text IS its own value, so it is
 * shown as the tendero wrote it and truncated by the card, not here.
 *
 * A coupon missing its own value field falls back to the type's name, exactly
 * as `couponValueLabel` does, so a card never renders an empty line.
 */
export function couponHighlightValue(coupon: Coupon): string {
  switch (coupon.type) {
    case "free_text":
      return coupon.freeText?.trim() || COUPON_TYPE_LABELS.free_text;
    case "percentage":
      return coupon.percentageValue === null
        ? COUPON_TYPE_LABELS.percentage
        : `-${coupon.percentageValue}%`;
    case "fixed_amount":
      return coupon.fixedAmountValue === null
        ? COUPON_TYPE_LABELS.fixed_amount
        : `-$${coupon.fixedAmountValue.toFixed(2)}`;
    case "combo": {
      const count = coupon.products.length;
      if (count < 1) return COUPON_TYPE_LABELS.combo;
      return count === 1 ? "2x1" : `Combo x${count}`;
    }
  }
}

/**
 * The Home tab's headline, in two tones: a light lead line and a bold one
 * under it (S14). It is built from the REAL count of active coupons, so the
 * screen never claims a number nobody earned.
 *
 * The empty case is not a zero. "0 cupones activos" is an accusation; a store
 * with nothing live is invited to create its first coupon instead, which is
 * also what the round black button beside it does.
 */
export type Headline = {
  lead: string;
  emphasis: string;
};

export function activeCouponsHeadline(activeCount: number): Headline {
  if (activeCount < 1) {
    return { lead: "Crea tu", emphasis: "primer cupón" };
  }
  return {
    lead: "Tienes",
    emphasis:
      activeCount === 1
        ? "1 cupón activo"
        : `${activeCount} cupones activos`,
  };
}

/**
 * How a customer with no profile is named. It is the app's wording and not the
 * API's: T6 and T7 deliberately answer `customerName: null` for an
 * OTP-registered user who never filled a name, and inventing one in the
 * backend would put Spanish copy in an English contract.
 *
 * It lives here so the scanner sheet and the redemption history cannot call
 * the same customer two different things.
 */
export const NAMELESS_CUSTOMER = "Cliente sin nombre";

/** One line of the redemption history: who redeemed, and on which DAY (S11). */
export function redemptionCustomerLabel(
  customerName: string | null | undefined,
): string {
  return customerName?.trim() || NAMELESS_CUSTOMER;
}
