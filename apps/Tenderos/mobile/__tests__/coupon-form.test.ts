import type { Coupon, CouponProductDetail } from "@repo/api-contracts";

import {
  EMPTY_COUPON_FORM,
  allowsMultipleProducts,
  couponToFormState,
  toCouponCreateRequest,
  toCouponUpdateRequest,
  toggleProductSelection,
  validateCouponForm,
  type CouponFormState,
} from "@/src/features/coupons/domain/coupon-form";

const CATALOG_PRODUCT: CouponProductDetail = {
  source: "store_catalog",
  productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Leche entera 1 L",
  category: { id: "c1", name: "Lácteos", key: "lacteos" },
};

const PRIVATE_PRODUCT: CouponProductDetail = {
  source: "store_private",
  productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Empanadas de la casa",
  category: null,
};

const THIRD_PRODUCT: CouponProductDetail = {
  source: "store_catalog",
  productId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name: "Gaseosa 500 ml",
  category: { id: "c2", name: "Bebidas gaseosas", key: "bebidas-gaseosas" },
};

const ref = (product: CouponProductDetail) => ({
  source: product.source,
  productId: product.productId,
});

function form(overrides: Partial<CouponFormState> = {}): CouponFormState {
  return {
    ...EMPTY_COUPON_FORM,
    title: "Promo de la semana",
    validFrom: "2026-11-01",
    validTo: "2026-11-30",
    totalStock: "50",
    ...overrides,
  };
}

describe("S5 product cardinality", () => {
  it("allows several products only for the 2x1 / combo type", () => {
    expect(allowsMultipleProducts("combo")).toBe(true);
    expect(allowsMultipleProducts("free_text")).toBe(false);
    expect(allowsMultipleProducts("percentage")).toBe(false);
    expect(allowsMultipleProducts("fixed_amount")).toBe(false);
  });

});

describe("toggleProductSelection", () => {
  it("replaces the selection for a single-product type", () => {
    const first = toggleProductSelection([], ref(CATALOG_PRODUCT), "percentage");
    expect(first).toEqual([ref(CATALOG_PRODUCT)]);

    const second = toggleProductSelection(
      first,
      ref(PRIVATE_PRODUCT),
      "percentage",
    );
    expect(second).toEqual([ref(PRIVATE_PRODUCT)]);
  });

  it("deselects the product that is already chosen", () => {
    expect(
      toggleProductSelection(
        [ref(CATALOG_PRODUCT)],
        ref(CATALOG_PRODUCT),
        "free_text",
      ),
    ).toEqual([]);
  });

  it("accumulates products for a combo and removes only the one tapped", () => {
    const one = toggleProductSelection([], ref(CATALOG_PRODUCT), "combo");
    const two = toggleProductSelection(one, ref(PRIVATE_PRODUCT), "combo");
    const three = toggleProductSelection(two, ref(THIRD_PRODUCT), "combo");

    expect(three).toEqual([
      ref(CATALOG_PRODUCT),
      ref(PRIVATE_PRODUCT),
      ref(THIRD_PRODUCT),
    ]);
    expect(toggleProductSelection(three, ref(PRIVATE_PRODUCT), "combo")).toEqual(
      [ref(CATALOG_PRODUCT), ref(THIRD_PRODUCT)],
    );
  });

  /**
   * The same product id under the two sources is two different products, so a
   * reference is identified by the pair and never by the id alone.
   */
  it("treats the same id under the two sources as two different products", () => {
    const shared = { productId: CATALOG_PRODUCT.productId };
    const selection = toggleProductSelection(
      [{ source: "store_catalog", ...shared }],
      { source: "store_private", ...shared },
      "combo",
    );

    expect(selection).toEqual([
      { source: "store_catalog", ...shared },
      { source: "store_private", ...shared },
    ]);
  });

  it("drops the extra products when the type stops allowing them", () => {
    const combo = [ref(CATALOG_PRODUCT), ref(PRIVATE_PRODUCT)];
    expect(toggleProductSelection(combo, ref(THIRD_PRODUCT), "fixed_amount")).toEqual(
      [ref(THIRD_PRODUCT)],
    );
  });
});

describe("validateCouponForm", () => {
  it("accepts a complete free-text coupon with one product", () => {
    expect(
      validateCouponForm(
        form({
          type: "free_text",
          freeText: "Lleva un café gratis con tu compra",
          products: [ref(CATALOG_PRODUCT)],
        }),
      ),
    ).toEqual({});
  });

  it("requires a title", () => {
    const errors = validateCouponForm(
      form({
        title: "   ",
        type: "percentage",
        percentageValue: "20",
        products: [ref(CATALOG_PRODUCT)],
      }),
    );
    expect(errors.title).toBe("Escribe un título para el cupón.");
  });

  it("rejects a title longer than the contract allows", () => {
    const errors = validateCouponForm(
      form({
        title: "a".repeat(121),
        type: "percentage",
        percentageValue: "20",
        products: [ref(CATALOG_PRODUCT)],
      }),
    );
    expect(errors.title).toBe("El título admite hasta 120 caracteres.");
  });

  it("requires the value field of the chosen type and nothing else", () => {
    expect(
      validateCouponForm(
        form({ type: "free_text", products: [ref(CATALOG_PRODUCT)] }),
      ).value,
    ).toBe("Escribe el texto del cupón.");
    expect(
      validateCouponForm(
        form({ type: "percentage", products: [ref(CATALOG_PRODUCT)] }),
      ).value,
    ).toBe("El descuento debe ser un número entero entre 1 y 100.");
    expect(
      validateCouponForm(
        form({ type: "fixed_amount", products: [ref(CATALOG_PRODUCT)] }),
      ).value,
    ).toBe("El monto debe ser mayor que cero, con hasta 2 decimales.");
    // A 2x1 / combo carries no value field at all.
    expect(
      validateCouponForm(
        form({ type: "combo", products: [ref(CATALOG_PRODUCT)] }),
      ),
    ).toEqual({});
  });

  it("rejects a percentage outside 1..100 and a fractional one", () => {
    const percentage = (percentageValue: string) =>
      validateCouponForm(
        form({ type: "percentage", percentageValue, products: [ref(CATALOG_PRODUCT)] }),
      ).value;

    expect(percentage("1")).toBeUndefined();
    expect(percentage("100")).toBeUndefined();
    expect(percentage("0")).toBeDefined();
    expect(percentage("101")).toBeDefined();
    expect(percentage("-5")).toBeDefined();
    expect(percentage("20.5")).toBeDefined();
    expect(percentage("veinte")).toBeDefined();
  });

  it("rejects a fixed amount that is not positive or has three decimals", () => {
    const amount = (fixedAmountValue: string) =>
      validateCouponForm(
        form({
          type: "fixed_amount",
          fixedAmountValue,
          products: [ref(CATALOG_PRODUCT)],
        }),
      ).value;

    expect(amount("0.01")).toBeUndefined();
    expect(amount("1.50")).toBeUndefined();
    expect(amount("12")).toBeUndefined();
    expect(amount("0")).toBeDefined();
    expect(amount("-1")).toBeDefined();
    expect(amount("1.555")).toBeDefined();
    expect(amount("")).toBeDefined();
  });

  it("requires both validity dates as dates only and in order", () => {
    const validity = (validFrom: string, validTo: string) =>
      validateCouponForm(
        form({
          type: "combo",
          validFrom,
          validTo,
          products: [ref(CATALOG_PRODUCT)],
        }),
      ).validity;

    expect(validity("2026-11-01", "2026-11-30")).toBeUndefined();
    expect(validity("2026-11-01", "2026-11-01")).toBeUndefined();
    expect(validity("2026-11-30", "2026-11-01")).toBe(
      "La vigencia debe empezar antes o el mismo día en que termina.",
    );
    expect(validity("", "2026-11-30")).toBe(
      "Usa el formato AAAA-MM-DD en ambas fechas.",
    );
    expect(validity("2026-11-01T00:00:00Z", "2026-11-30")).toBe(
      "Usa el formato AAAA-MM-DD en ambas fechas.",
    );
    expect(validity("2026-02-30", "2026-11-30")).toBe(
      "Usa el formato AAAA-MM-DD en ambas fechas.",
    );
  });

  it("requires a nonnegative whole number of total stock", () => {
    const stock = (totalStock: string) =>
      validateCouponForm(
        form({ type: "combo", totalStock, products: [ref(CATALOG_PRODUCT)] }),
      ).totalStock;

    expect(stock("0")).toBeUndefined();
    expect(stock("250")).toBeUndefined();
    expect(stock("-1")).toBe("El stock total debe ser un número entero de 0 o más.");
    expect(stock("2.5")).toBeDefined();
    expect(stock("")).toBeDefined();
  });

  it("rejects zero products for every type (S5)", () => {
    for (const type of ["free_text", "percentage", "fixed_amount", "combo"] as const) {
      const errors = validateCouponForm(
        form({
          type,
          freeText: "texto",
          percentageValue: "20",
          fixedAmountValue: "1.50",
          products: [],
        }),
      );
      expect(errors.products).toBeDefined();
    }
  });

  it("rejects two products on a type that links exactly one (S5)", () => {
    for (const type of ["free_text", "percentage", "fixed_amount"] as const) {
      const errors = validateCouponForm(
        form({
          type,
          freeText: "texto",
          percentageValue: "20",
          fixedAmountValue: "1.50",
          products: [ref(CATALOG_PRODUCT), ref(PRIVATE_PRODUCT)],
        }),
      );
      expect(errors.products).toBe("Este tipo de cupón admite 1 solo producto.");
    }
  });

  it("accepts one product and several products on a 2x1 / combo (S5)", () => {
    expect(
      validateCouponForm(
        form({ type: "combo", products: [ref(CATALOG_PRODUCT)] }),
      ).products,
    ).toBeUndefined();
    expect(
      validateCouponForm(
        form({
          type: "combo",
          products: [ref(CATALOG_PRODUCT), ref(PRIVATE_PRODUCT), ref(THIRD_PRODUCT)],
        }),
      ).products,
    ).toBeUndefined();
  });

  it("rejects the same product referenced twice", () => {
    expect(
      validateCouponForm(
        form({
          type: "combo",
          products: [ref(CATALOG_PRODUCT), ref(CATALOG_PRODUCT)],
        }),
      ).products,
    ).toBe("Un cupón no puede repetir el mismo producto.");
  });
});

describe("toCouponCreateRequest", () => {
  it("sends only the value field of the chosen type", () => {
    expect(
      toCouponCreateRequest(
        form({
          type: "percentage",
          percentageValue: "25",
          freeText: "ignorado",
          fixedAmountValue: "9.99",
          products: [ref(CATALOG_PRODUCT)],
        }),
      ),
    ).toEqual({
      type: "percentage",
      title: "Promo de la semana",
      validFrom: "2026-11-01",
      validTo: "2026-11-30",
      totalStock: 50,
      paused: false,
      percentageValue: 25,
      products: [ref(CATALOG_PRODUCT)],
    });
  });

  it("sends the free text, the fixed amount and the combo with no value field", () => {
    expect(
      toCouponCreateRequest(
        form({
          type: "free_text",
          freeText: "  Lleva un postre gratis  ",
          products: [ref(PRIVATE_PRODUCT)],
        }),
      ),
    ).toMatchObject({ type: "free_text", freeText: "Lleva un postre gratis" });

    expect(
      toCouponCreateRequest(
        form({
          type: "fixed_amount",
          fixedAmountValue: "2.50",
          products: [ref(PRIVATE_PRODUCT)],
        }),
      ),
    ).toMatchObject({ type: "fixed_amount", fixedAmountValue: 2.5 });

    const combo = toCouponCreateRequest(
      form({
        type: "combo",
        products: [ref(CATALOG_PRODUCT), ref(PRIVATE_PRODUCT)],
      }),
    );
    expect(combo).toMatchObject({ type: "combo" });
    expect(combo).not.toHaveProperty("freeText");
    expect(combo).not.toHaveProperty("percentageValue");
    expect(combo).not.toHaveProperty("fixedAmountValue");
  });

  it("carries the optional description and image key only when they are set", () => {
    const bare = toCouponCreateRequest(
      form({ type: "combo", products: [ref(CATALOG_PRODUCT)] }),
    );
    expect(bare).not.toHaveProperty("description");
    expect(bare).not.toHaveProperty("imageObjectKey");

    expect(
      toCouponCreateRequest(
        form({
          type: "combo",
          description: "  Válido solo en tienda  ",
          imageObjectKey: "coupons/store/one.jpg",
          products: [ref(CATALOG_PRODUCT)],
        }),
      ),
    ).toMatchObject({
      description: "Válido solo en tienda",
      imageObjectKey: "coupons/store/one.jpg",
    });
  });

  it("refuses to build a payload the form itself rejects", () => {
    expect(
      toCouponCreateRequest(form({ type: "percentage", products: [] })),
    ).toBeNull();
    expect(
      toCouponCreateRequest(
        form({
          type: "percentage",
          percentageValue: "200",
          products: [ref(CATALOG_PRODUCT)],
        }),
      ),
    ).toBeNull();
  });
});

describe("toCouponUpdateRequest", () => {
  it("restates the type, which the backend requires and refuses to change", () => {
    expect(
      toCouponUpdateRequest(
        form({
          type: "combo",
          products: [ref(CATALOG_PRODUCT), ref(PRIVATE_PRODUCT)],
        }),
      ),
    ).toEqual({
      type: "combo",
      title: "Promo de la semana",
      description: null,
      validFrom: "2026-11-01",
      validTo: "2026-11-30",
      totalStock: 50,
      products: [ref(CATALOG_PRODUCT), ref(PRIVATE_PRODUCT)],
    });
  });

  /**
   * `paused` is deliberately absent from the form state and from the UPDATE
   * payload: pause and activate are their own routes, so an edit can never take
   * a coupon out of circulation by accident. Creating sends a constant
   * `paused: false` instead, because a coupon is born active.
   */
  it("never sends the paused flag on an edit", () => {
    const state = form({ type: "combo", products: [ref(CATALOG_PRODUCT)] });
    expect(state).not.toHaveProperty("paused");
    expect(toCouponUpdateRequest(state)).not.toHaveProperty("paused");
    expect(toCouponCreateRequest(state)).toMatchObject({ paused: false });
  });

  it("clears a description the tendero emptied", () => {
    expect(
      toCouponUpdateRequest(
        form({ type: "combo", description: "", products: [ref(CATALOG_PRODUCT)] }),
      ),
    ).toMatchObject({ description: null });
  });
});

describe("couponToFormState", () => {
  const coupon: Coupon = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    storeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    type: "percentage",
    title: "15% en lácteos",
    description: "Solo los martes",
    freeText: null,
    percentageValue: 15,
    fixedAmountValue: null,
    validFrom: "2026-11-01",
    validTo: "2026-11-30",
    totalStock: 40,
    claimedCount: 7,
    remainingStock: 33,
    paused: true,
    imageUrl: "https://garage.test/coupons/one.jpg",
    products: [CATALOG_PRODUCT],
  };

  it("round-trips a stored coupon into an editable form", () => {
    const state = couponToFormState(coupon);

    expect(state).toEqual({
      type: "percentage",
      title: "15% en lácteos",
      description: "Solo los martes",
      freeText: "",
      percentageValue: "15",
      fixedAmountValue: "",
      validFrom: "2026-11-01",
      validTo: "2026-11-30",
      totalStock: "40",
      products: [ref(CATALOG_PRODUCT)],
      imageObjectKey: null,
    });
    expect(validateCouponForm(state)).toEqual({});
  });

  /**
   * S11 — the form never carries the coupon id or the store id, so no field
   * and no draft can leak one onto a screen.
   */
  it("carries neither the coupon id nor the store id", () => {
    expect(JSON.stringify(couponToFormState(coupon))).not.toContain(coupon.id);
    expect(JSON.stringify(couponToFormState(coupon))).not.toContain(
      coupon.storeId,
    );
  });
});
