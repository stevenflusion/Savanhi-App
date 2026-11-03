import type { Coupon, ImageUploadTicket } from "@repo/api-contracts";

import { createCouponsFetchRepository } from "@/src/features/coupons/infrastructure/coupons-fetch-repository";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const COUPON_ID = "22222222-2222-4222-8222-222222222222";

const COUPON: Coupon = {
  id: COUPON_ID,
  storeId: STORE_ID,
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
};

type Call = { path: string; init?: RequestInit };

/**
 * A fake of the authenticated JSON transport the AuthProvider owns. It records
 * every call and answers from a routing table, so the repository is exercised
 * without a network, a session or a React tree.
 */
function createTransport(
  answers: Record<
    string,
    | { success: true; data: unknown }
    | { success: false; error: string }
    | undefined
  > = {},
  options: { unparseable?: boolean } = {},
) {
  const calls: Call[] = [];

  const request = async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    const key = `${String(init?.method ?? "GET")} ${path}`;
    const answer = answers[key];
    if (!answer) {
      return { success: false as const, error: `No route for ${key}` };
    }
    if (!answer.success) {
      return { success: false as const, error: answer.error };
    }
    return {
      success: true as const,
      response: {
        json: async () => {
          if (options.unparseable) throw new Error("not json");
          return { data: answer.data };
        },
      } as unknown as Response,
    };
  };

  return { request, calls };
}

const body = (call: Call) => JSON.parse(String(call.init?.body ?? "null"));

describe("createCouponsFetchRepository", () => {
  it("reads the store's coupons from the store-scoped route", async () => {
    const { request, calls } = createTransport({
      [`GET /api/v1/tenderos/stores/${STORE_ID}/coupons`]: {
        success: true,
        data: [COUPON],
      },
    });

    const result = await createCouponsFetchRepository(request).listStoreCoupons(
      STORE_ID,
    );

    expect(result).toEqual({ success: true, data: [COUPON] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(
      `/api/v1/tenderos/stores/${STORE_ID}/coupons`,
    );
    expect(calls[0]?.init?.method ?? "GET").toBe("GET");
  });

  it("reads the tendero's own stores", async () => {
    const { request } = createTransport({
      "GET /api/v1/tenderos/stores/me": {
        success: true,
        data: [{ id: STORE_ID, name: "Tienda Doña Rosa" }],
      },
    });

    expect(await createCouponsFetchRepository(request).listOwnStores()).toEqual({
      success: true,
      data: [{ id: STORE_ID, name: "Tienda Doña Rosa" }],
    });
  });

  /**
   * The picker offers both product models S5 keeps distinguishable: the global
   * catalog assignments and the store-private products, each tagged with its
   * source.
   *
   * `key` is null on BOTH sources on purpose: neither
   * `GET /stores/:id/catalog` nor `GET /stores/:id/products` carries the
   * catalog category slug today (`CatalogProduct` has `categoryId` and
   * `categoryName` and no slug), so the picker shows the category name and the
   * default icon. The real slug arrives on the coupon itself —
   * `Coupon.products[].category.key`, which T4 resolves — which is where S5's
   * display acceptance needs it.
   */
  it("builds the product picker from both product sources", async () => {
    const { request, calls } = createTransport({
      [`GET /api/v1/tenderos/stores/${STORE_ID}/catalog`]: {
        success: true,
        data: [
          {
            id: "assignment-1",
            product: {
              commercialName: "Leche entera 1 L",
              categoryId: "cat-1",
              categoryName: "Lácteos",
            },
            active: true,
          },
        ],
      },
      [`GET /api/v1/tenderos/stores/${STORE_ID}/products`]: {
        success: true,
        data: [
          {
            id: "private-1",
            name: "Empanadas de la casa",
            categoryId: null,
            categoryName: null,
            active: true,
          },
        ],
      },
    });

    const result = await createCouponsFetchRepository(
      request,
    ).listProductOptions(STORE_ID);

    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual([
      {
        source: "store_catalog",
        productId: "assignment-1",
        name: "Leche entera 1 L",
        category: { id: "cat-1", name: "Lácteos", key: null },
      },
      {
        source: "store_private",
        productId: "private-1",
        name: "Empanadas de la casa",
        category: null,
      },
    ]);
    expect(calls.map((call) => call.path)).toEqual([
      `/api/v1/tenderos/stores/${STORE_ID}/catalog`,
      `/api/v1/tenderos/stores/${STORE_ID}/products`,
    ]);
  });

  it("carries the store-authored category name of a private product", async () => {
    const { request } = createTransport({
      [`GET /api/v1/tenderos/stores/${STORE_ID}/catalog`]: {
        success: true,
        data: [],
      },
      [`GET /api/v1/tenderos/stores/${STORE_ID}/products`]: {
        success: true,
        data: [
          {
            id: "private-1",
            name: "Empanadas de la casa",
            categoryId: "store-cat-1",
            categoryName: "Mis empanadas",
            active: true,
          },
        ],
      },
    });

    const result = await createCouponsFetchRepository(
      request,
    ).listProductOptions(STORE_ID);

    expect(result.success && result.data).toEqual([
      {
        source: "store_private",
        productId: "private-1",
        name: "Empanadas de la casa",
        category: { id: "store-cat-1", name: "Mis empanadas", key: null },
      },
    ]);
  });

  it("leaves out a product that is no longer active in the store", async () => {
    const { request } = createTransport({
      [`GET /api/v1/tenderos/stores/${STORE_ID}/catalog`]: {
        success: true,
        data: [
          {
            id: "assignment-1",
            product: { commercialName: "Retirado" },
            active: false,
          },
        ],
      },
      [`GET /api/v1/tenderos/stores/${STORE_ID}/products`]: {
        success: true,
        data: [{ id: "private-1", name: "Retirado también", active: false }],
      },
    });

    const result = await createCouponsFetchRepository(
      request,
    ).listProductOptions(STORE_ID);

    expect(result).toEqual({ success: true, data: [] });
  });

  it("posts a create payload verbatim to the store-scoped route", async () => {
    const { request, calls } = createTransport({
      [`POST /api/v1/tenderos/stores/${STORE_ID}/coupons`]: {
        success: true,
        data: COUPON,
      },
    });

    const payload = {
      type: "percentage" as const,
      title: "15% en lácteos",
      validFrom: "2026-11-01",
      validTo: "2026-11-30",
      totalStock: 40,
      paused: false,
      percentageValue: 15,
      products: [
        { source: "store_catalog" as const, productId: "assignment-1" },
      ],
    };

    expect(
      await createCouponsFetchRepository(request).createCoupon(
        STORE_ID,
        payload,
      ),
    ).toEqual({ success: true, data: COUPON });
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(body(calls[0]!)).toEqual(payload);
  });

  it("patches an update onto the coupon-scoped route", async () => {
    const { request, calls } = createTransport({
      [`PATCH /api/v1/tenderos/coupons/${COUPON_ID}`]: {
        success: true,
        data: COUPON,
      },
    });

    const payload = { type: "percentage" as const, totalStock: 60 };
    expect(
      await createCouponsFetchRepository(request).updateCoupon(
        COUPON_ID,
        payload,
      ),
    ).toEqual({ success: true, data: COUPON });
    expect(calls[0]?.path).toBe(`/api/v1/tenderos/coupons/${COUPON_ID}`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(body(calls[0]!)).toEqual(payload);
  });

  /**
   * Pause and activate are two routes and no body, exactly as T4 built them:
   * taking a coupon out of circulation must not require restating its type.
   */
  it("pauses through the pause route with no payload at all", async () => {
    const { request, calls } = createTransport({
      [`POST /api/v1/tenderos/coupons/${COUPON_ID}/pause`]: {
        success: true,
        data: { ...COUPON, paused: true },
      },
    });

    const result = await createCouponsFetchRepository(request).setCouponPaused(
      COUPON_ID,
      true,
    );

    expect(result).toEqual({ success: true, data: { ...COUPON, paused: true } });
    expect(calls[0]?.path).toBe(
      `/api/v1/tenderos/coupons/${COUPON_ID}/pause`,
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("activates through the activate route", async () => {
    const { request, calls } = createTransport({
      [`POST /api/v1/tenderos/coupons/${COUPON_ID}/activate`]: {
        success: true,
        data: { ...COUPON, paused: false },
      },
    });

    const result = await createCouponsFetchRepository(request).setCouponPaused(
      COUPON_ID,
      false,
    );

    expect(result).toEqual({
      success: true,
      data: { ...COUPON, paused: false },
    });
    expect(calls[0]?.path).toBe(
      `/api/v1/tenderos/coupons/${COUPON_ID}/activate`,
    );
  });

  it("asks for a coupon image ticket on the store, not on the coupon", async () => {
    const ticket: ImageUploadTicket = {
      objectKey: `coupons/${STORE_ID}/one.jpg`,
      uploadUrl: "https://garage.test/upload/1",
      contentType: "image/jpeg",
      contentLength: 1024,
      expiresInSeconds: 900,
    };
    const { request, calls } = createTransport({
      [`POST /api/v1/tenderos/stores/${STORE_ID}/coupon-image-uploads`]: {
        success: true,
        data: ticket,
      },
    });

    expect(
      await createCouponsFetchRepository(request).requestImageTicket(STORE_ID, {
        contentType: "image/jpeg",
        contentLength: 1024,
      }),
    ).toEqual({ success: true, data: ticket });
    expect(body(calls[0]!)).toEqual({
      contentType: "image/jpeg",
      contentLength: 1024,
    });
  });

  describe("error mapping", () => {
    const failing = (error: string) =>
      createTransport({
        [`POST /api/v1/tenderos/stores/${STORE_ID}/coupons`]: {
          success: false,
          error,
        },
      }).request;

    const create = (error: string) =>
      createCouponsFetchRepository(failing(error)).createCoupon(STORE_ID, {
        type: "combo",
        title: "Combo",
        validFrom: "2026-11-01",
        validTo: "2026-11-30",
        totalStock: 1,
        paused: false,
        products: [{ source: "store_private", productId: "p" }],
      });

    it("renders the API's own messages in Spanish", async () => {
      expect(
        await create(
          "The total stock cannot be lower than the number of claims already made.",
        ),
      ).toEqual({
        success: false,
        error:
          "El stock total no puede ser menor que la cantidad de cupones ya reclamados.",
      });

      expect(await create("Every coupon product must belong to this store.")).toEqual(
        {
          success: false,
          error: "Cada producto del cupón debe ser de esta tienda.",
        },
      );

      expect(await create("The coupon type cannot be changed.")).toEqual({
        success: false,
        error: "El tipo de cupón no se puede cambiar.",
      });

      expect(await create("A coupon cannot reference the same product twice.")).toEqual(
        {
          success: false,
          error: "Un cupón no puede repetir el mismo producto.",
        },
      );

      expect(await create("Store does not belong to this tendero.")).toEqual({
        success: false,
        error: "Esta tienda no pertenece a tu cuenta.",
      });

      expect(await create("Coupon not found.")).toEqual({
        success: false,
        error: "Este cupón ya no existe.",
      });

      expect(await create("Invalid request payload.")).toEqual({
        success: false,
        error: "Revisa los datos del cupón e inténtalo de nuevo.",
      });
    });

    it("never leaves an English message on screen", async () => {
      const result = await create("Some brand new backend wording.");

      expect(result).toEqual({
        success: false,
        error: "No se pudo guardar el cupón.",
      });
    });

    it("reports a response body it cannot read as a failure", async () => {
      const { request } = createTransport(
        {
          [`GET /api/v1/tenderos/stores/${STORE_ID}/coupons`]: {
            success: true,
            data: [COUPON],
          },
        },
        { unparseable: true },
      );

      expect(
        await createCouponsFetchRepository(request).listStoreCoupons(STORE_ID),
      ).toEqual({
        success: false,
        error: "No se pudieron cargar los cupones.",
      });
    });

    it("maps a failure of each action to its own Spanish fallback", async () => {
      const dead = createTransport().request;
      const repository = createCouponsFetchRepository(dead);

      expect(await repository.listOwnStores()).toEqual({
        success: false,
        error: "No se pudo cargar tu tienda.",
      });
      expect(await repository.listStoreCoupons(STORE_ID)).toEqual({
        success: false,
        error: "No se pudieron cargar los cupones.",
      });
      expect(await repository.listProductOptions(STORE_ID)).toEqual({
        success: false,
        error: "No se pudieron cargar los productos de tu tienda.",
      });
      expect(
        await repository.updateCoupon(COUPON_ID, { type: "combo", totalStock: 1 }),
      ).toEqual({
        success: false,
        error: "No se pudo guardar el cupón.",
      });
      expect(await repository.setCouponPaused(COUPON_ID, true)).toEqual({
        success: false,
        error: "No se pudo pausar el cupón.",
      });
      expect(await repository.setCouponPaused(COUPON_ID, false)).toEqual({
        success: false,
        error: "No se pudo activar el cupón.",
      });
      expect(
        await repository.requestImageTicket(STORE_ID, {
          contentType: "image/png",
          contentLength: 10,
        }),
      ).toEqual({
        success: false,
        error: "No se pudo subir la foto del cupón.",
      });
    });
  });
});
