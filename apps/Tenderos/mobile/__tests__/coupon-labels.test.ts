import type { Coupon } from "@repo/api-contracts";

import {
  COUPON_TYPE_LABELS,
  comboShapeLabel,
  couponStockLabel,
  couponTypeLabel,
  couponValueLabel,
  productCardinalityHint,
} from "@/src/features/coupons/domain/coupon-labels";

const BASE: Coupon = {
  id: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  type: "combo",
  title: "Promo",
  description: null,
  freeText: null,
  percentageValue: null,
  fixedAmountValue: null,
  validFrom: "2026-11-01",
  validTo: "2026-11-30",
  totalStock: 40,
  claimedCount: 7,
  remainingStock: 33,
  paused: false,
  imageUrl: null,
  products: [],
};

const product = (productId: string) => ({
  source: "store_private" as const,
  productId,
  name: `Producto ${productId}`,
  category: null,
});

describe("couponTypeLabel", () => {
  it("names the four types in Spanish and nothing else", () => {
    expect(couponTypeLabel("free_text")).toBe("Texto libre");
    expect(couponTypeLabel("combo")).toBe("2x1 / Combo");
    expect(couponTypeLabel("percentage")).toBe("% de descuento");
    expect(couponTypeLabel("fixed_amount")).toBe("Monto fijo");
    expect(Object.keys(COUPON_TYPE_LABELS).sort()).toEqual([
      "combo",
      "fixed_amount",
      "free_text",
      "percentage",
    ]);
  });
});

describe("comboShapeLabel", () => {
  /**
   * S5 — one product makes a `combo` coupon behave as a 2x1 and two or more
   * make it a combo, which is what keeps the closed type set at four.
   */
  it("names a combo coupon by its product count", () => {
    expect(comboShapeLabel(0)).toBeNull();
    expect(comboShapeLabel(1)).toBe("2x1");
    expect(comboShapeLabel(2)).toBe("Combo");
    expect(comboShapeLabel(5)).toBe("Combo");
  });
});

describe("productCardinalityHint", () => {
  it("tells the tendero how many products the chosen type links", () => {
    expect(productCardinalityHint("free_text")).toBe(
      "Elige exactamente 1 producto.",
    );
    expect(productCardinalityHint("percentage")).toBe(
      "Elige exactamente 1 producto.",
    );
    expect(productCardinalityHint("fixed_amount")).toBe(
      "Elige exactamente 1 producto.",
    );
    expect(productCardinalityHint("combo")).toBe(
      "Elige 1 producto para un 2x1, o 2 o más para un combo.",
    );
  });
});

describe("couponValueLabel", () => {
  it("renders the value field of the coupon's own type (S4)", () => {
    expect(
      couponValueLabel({
        ...BASE,
        type: "free_text",
        freeText: "Lleva un café gratis",
      }),
    ).toBe("Lleva un café gratis");

    expect(
      couponValueLabel({ ...BASE, type: "percentage", percentageValue: 15 }),
    ).toBe("15% de descuento");

    expect(
      couponValueLabel({
        ...BASE,
        type: "fixed_amount",
        fixedAmountValue: 2.5,
      }),
    ).toBe("$2.50 de descuento");

    expect(
      couponValueLabel({
        ...BASE,
        type: "fixed_amount",
        fixedAmountValue: 12,
      }),
    ).toBe("$12.00 de descuento");
  });

  it("derives a 2x1 or a combo from the product count", () => {
    expect(
      couponValueLabel({ ...BASE, type: "combo", products: [product("a")] }),
    ).toBe("2x1");
    expect(
      couponValueLabel({
        ...BASE,
        type: "combo",
        products: [product("a"), product("b")],
      }),
    ).toBe("Combo de 2 productos");
    expect(
      couponValueLabel({
        ...BASE,
        type: "combo",
        products: [product("a"), product("b"), product("c")],
      }),
    ).toBe("Combo de 3 productos");
  });

  it("falls back to the type name when the value is missing", () => {
    expect(couponValueLabel({ ...BASE, type: "free_text" })).toBe(
      "Texto libre",
    );
    expect(couponValueLabel({ ...BASE, type: "percentage" })).toBe(
      "% de descuento",
    );
    expect(couponValueLabel({ ...BASE, type: "combo", products: [] })).toBe(
      "2x1 / Combo",
    );
  });

  it("never renders an identifier or a clock time (S11)", () => {
    const rendered = [
      couponValueLabel({ ...BASE, type: "combo", products: [product("a")] }),
      couponValueLabel({ ...BASE, type: "percentage", percentageValue: 99 }),
    ].join(" ");

    expect(rendered).not.toContain(BASE.id);
    expect(rendered).not.toContain(BASE.storeId);
    expect(rendered).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("couponStockLabel", () => {
  it("reports the claimed and remaining counts as counts, not as stock rows", () => {
    expect(couponStockLabel({ ...BASE, claimedCount: 7, remainingStock: 33 })).toBe(
      "7 reclamados · 33 disponibles",
    );
    expect(
      couponStockLabel({ ...BASE, claimedCount: 0, remainingStock: 40 }),
    ).toBe("0 reclamados · 40 disponibles");
    expect(
      couponStockLabel({
        ...BASE,
        totalStock: 7,
        claimedCount: 7,
        remainingStock: 0,
      }),
    ).toBe("7 reclamados · agotado");
  });
});
