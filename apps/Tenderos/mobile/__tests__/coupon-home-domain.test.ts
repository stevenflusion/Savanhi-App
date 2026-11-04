process.env.TZ = "America/Bogota";

import type { Coupon } from "@repo/api-contracts";

import {
  DEFAULT_CATEGORY_COLOR,
  categoryColorFor,
} from "@/src/features/coupons/domain/category-colors";
import {
  activeCouponsHeadline,
  couponHighlightValue,
} from "@/src/features/coupons/domain/coupon-labels";
import {
  isCouponActive,
  isCouponExpired,
  selectActiveCoupons,
} from "@/src/features/coupons/domain/coupon-status";

const coupon = (overrides: Partial<Coupon> = {}): Coupon => ({
  id: "22222222-2222-4222-8222-222222222222",
  storeId: "11111111-1111-4111-8111-111111111111",
  type: "percentage",
  title: "15% en lácteos",
  description: null,
  freeText: null,
  percentageValue: 15,
  fixedAmountValue: null,
  validFrom: "2026-11-01",
  validTo: "2026-11-30",
  totalStock: 40,
  claimedCount: 7,
  remainingStock: 33,
  paused: false,
  imageUrl: null,
  products: [],
  ...overrides,
});

const TODAY = "2026-11-03";

describe("coupon status", () => {
  it("treats a coupon whose window has not ended as not expired", () => {
    expect(isCouponExpired(coupon({ validTo: "2026-11-30" }), TODAY)).toBe(
      false,
    );
  });

  it("keeps a coupon alive on its very last day", () => {
    expect(isCouponExpired(coupon({ validTo: TODAY }), TODAY)).toBe(false);
  });

  it("expires a coupon the day after its window ends", () => {
    expect(isCouponExpired(coupon({ validTo: "2026-11-02" }), TODAY)).toBe(
      true,
    );
  });

  it("is active only when it is neither paused nor expired", () => {
    expect(isCouponActive(coupon(), TODAY)).toBe(true);
    expect(isCouponActive(coupon({ paused: true }), TODAY)).toBe(false);
    expect(isCouponActive(coupon({ validTo: "2026-10-31" }), TODAY)).toBe(
      false,
    );
    expect(
      isCouponActive(coupon({ paused: true, validTo: "2026-10-31" }), TODAY),
    ).toBe(false);
  });

  it("keeps the order of the list it filters", () => {
    const list = [
      coupon({ id: "a", title: "Uno" }),
      coupon({ id: "b", title: "Dos", paused: true }),
      coupon({ id: "c", title: "Tres" }),
      coupon({ id: "d", title: "Cuatro", validTo: "2026-10-01" }),
    ];

    expect(selectActiveCoupons(list, TODAY).map((item) => item.title)).toEqual([
      "Uno",
      "Tres",
    ]);
  });
});

describe("the Home headline", () => {
  it("invites a store with no active coupon to create its first", () => {
    expect(activeCouponsHeadline(0)).toEqual({
      lead: "Crea tu",
      emphasis: "primer cupón",
    });
  });

  it("uses the singular for exactly one active coupon", () => {
    expect(activeCouponsHeadline(1)).toEqual({
      lead: "Tienes",
      emphasis: "1 cupón activo",
    });
  });

  it("uses the plural from two active coupons on", () => {
    expect(activeCouponsHeadline(2)).toEqual({
      lead: "Tienes",
      emphasis: "2 cupones activos",
    });
    expect(activeCouponsHeadline(11).emphasis).toBe("11 cupones activos");
  });

  it("never renders a count it was not given", () => {
    expect(activeCouponsHeadline(0).emphasis).not.toMatch(/\d/);
  });
});

describe("the big value on a coupon card", () => {
  it("writes a percentage as a discount sign and a number", () => {
    expect(couponHighlightValue(coupon({ percentageValue: 20 }))).toBe("-20%");
  });

  it("writes a fixed amount with its currency sign", () => {
    expect(
      couponHighlightValue(
        coupon({ type: "fixed_amount", percentageValue: null, fixedAmountValue: 2 }),
      ),
    ).toBe("-$2.00");
  });

  it("writes a one-product combo as 2x1 and a bigger one by its count", () => {
    const base = coupon({ type: "combo", percentageValue: null });
    expect(
      couponHighlightValue({
        ...base,
        products: [
          {
            source: "store_private",
            productId: "p1",
            name: "Empanada",
            category: null,
          },
        ],
      }),
    ).toBe("2x1");
    expect(
      couponHighlightValue({
        ...base,
        products: [
          {
            source: "store_private",
            productId: "p1",
            name: "Empanada",
            category: null,
          },
          {
            source: "store_private",
            productId: "p2",
            name: "Café",
            category: null,
          },
          {
            source: "store_private",
            productId: "p3",
            name: "Pan",
            category: null,
          },
        ],
      }),
    ).toBe("Combo x3");
  });

  it("writes a free-text coupon as its own text", () => {
    expect(
      couponHighlightValue(
        coupon({
          type: "free_text",
          percentageValue: null,
          freeText: "Lleva un café gratis",
        }),
      ),
    ).toBe("Lleva un café gratis");
  });

  it("never falls back to an empty string", () => {
    expect(
      couponHighlightValue(
        coupon({ type: "percentage", percentageValue: null }),
      ),
    ).toBe("% de descuento");
  });
});

describe("the pastel colour of a category", () => {
  it("answers the neutral default for a product with no category", () => {
    expect(categoryColorFor(null)).toEqual(DEFAULT_CATEGORY_COLOR);
    expect(categoryColorFor(undefined)).toEqual(DEFAULT_CATEGORY_COLOR);
  });

  it("answers the neutral default for a category with no stable key", () => {
    expect(
      categoryColorFor({ id: "cat-1", name: "Lo que yo quiera", key: null }),
    ).toEqual(DEFAULT_CATEGORY_COLOR);
  });

  it("is deterministic: the same key always yields the same colour", () => {
    const first = categoryColorFor({ id: "x", name: "Lácteos", key: "lacteos" });
    const second = categoryColorFor({
      id: "y",
      name: "Otro nombre",
      key: "lacteos",
    });

    expect(first).toEqual(second);
    expect(first).not.toEqual(DEFAULT_CATEGORY_COLOR);
  });

  it("gives an unmapped key a stable colour instead of guessing from the name", () => {
    const once = categoryColorFor({ id: "z", name: "Ferretería", key: "ferreteria" });
    const twice = categoryColorFor({ id: "z", name: "Ferretería", key: "ferreteria" });

    expect(once).toEqual(twice);
  });

  it("answers a surface and a matching ink for every colour it returns", () => {
    const colour = categoryColorFor({ id: "x", name: "Lácteos", key: "lacteos" });
    expect(colour.surface).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colour.ink).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
