import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type {
  OtpRequestResponse,
  OtpVerifyResponse,
} from "@repo/api-contracts/auth";
import type { Store } from "@repo/api-contracts/products";
import type {
  Coupon,
  CouponProductRef,
  ImageUploadTicket,
} from "@repo/api-contracts";
import {
  createAuthRouter,
  createBackendApp,
  createBackendContext,
  createDatabaseConnection,
  createObjectStorage,
  type BackendEnv,
  type StorageEnv,
} from "@repo/backend-core";
import { createApiRouter } from "./index.js";

const env: BackendEnv = {
  serviceName: "coupons-route-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "coupons-route-tests",
  authJwtAudience: "savanhi-api",
  trustProxy: false,
  otpProvider: "development",
  otpDevCode: "123456",
  rateLimits: {
    api: 10_000,
    otpRequest: 10_000,
    otpVerify: 10_000,
    refresh: 10_000,
  },
};

/** The committed development fixture from infra/garage/garage.toml. */
const storageEnv: StorageEnv = {
  endpoint: process.env.GARAGE_ENDPOINT ?? "http://127.0.0.1:3900",
  region: process.env.GARAGE_REGION ?? "garage",
  bucket: process.env.GARAGE_BUCKET ?? "savanhi-dev",
  accessKeyId: process.env.GARAGE_ACCESS_KEY_ID ?? "GK1a2b3c4d5e6f708192a3b4c5",
  secretAccessKey:
    process.env.GARAGE_SECRET_ACCESS_KEY ??
    "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  uploadUrlTtlSeconds: 900,
  readUrlTtlSeconds: 3600,
};

async function startHarness() {
  const context = createBackendContext(env, {
    defaultRegistrationRole: "tendero",
  });
  const { authRouter, requireRole } = createAuthRouter(context.authService, {
    limits: context.env.rateLimits,
  });
  const storage = createObjectStorage(storageEnv);
  const server = createBackendApp({
    env,
    routers: [authRouter, createApiRouter({ context, requireRole, storage })],
  }).listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await storage.destroy();
      await context.db.pool.end();
    },
  };
}

/** Every date in a coupon payload is date-only, so a fixed window is safe. */
const VALID_FROM = "2026-01-01";
const VALID_TO = "2026-12-31";

type CouponBody = Record<string, unknown>;

/** The payload shape of each type, with its own value field (S4). */
const couponBody = (
  type: Coupon["type"],
  products: CouponProductRef[],
  overrides: CouponBody = {},
): CouponBody => ({
  type,
  title: `Cupon ${type}`,
  validFrom: VALID_FROM,
  validTo: VALID_TO,
  totalStock: 10,
  products,
  ...(type === "free_text" ? { freeText: "Lleva una funda gratis" } : {}),
  ...(type === "percentage" ? { percentageValue: 20 } : {}),
  ...(type === "fixed_amount" ? { fixedAmountValue: 1.5 } : {}),
  ...overrides,
});

test("tendero coupon routes are owner scoped and type safe", async (t) => {
  const harness = await startHarness();
  const cleanupDb = createDatabaseConnection(env);
  const runId = randomUUID();
  const emails: string[] = [];
  const userIds: string[] = [];
  let requestSequence = 0;

  /** Everything the fixture creates outside the HTTP routes carries this. */
  const catalogSlug = `coupon-routes-${runId}`;

  const purge = async () => {
    for (const userId of userIds) {
      // `coupons` cascades to `coupon_products` and `coupon_claims`, and those
      // hold the RESTRICT references, so coupons go before any product row.
      await cleanupDb.pool.query(
        "delete from coupons where store_id in (select id from stores where owner_user_id = $1)",
        [userId],
      );
      await cleanupDb.pool.query(
        "delete from products where store_id in (select id from stores where owner_user_id = $1)",
        [userId],
      );
      await cleanupDb.pool.query(
        "delete from stores where owner_user_id = $1",
        [userId],
      );
      await cleanupDb.pool.query("delete from users where id = $1", [userId]);
    }
    await cleanupDb.pool.query(
      "delete from catalog_products where category_id in (select id from catalog_categories where slug = $1)",
      [catalogSlug],
    );
    await cleanupDb.pool.query(
      "delete from catalog_brands where name = $1",
      [`Coupon routes brand ${runId}`],
    );
    await cleanupDb.pool.query("delete from catalog_categories where slug = $1", [
      catalogSlug,
    ]);
    if (emails.length > 0) {
      await cleanupDb.pool.query(
        "delete from otp_request_leases where email_normalized = any($1::text[])",
        [emails],
      );
      await cleanupDb.pool.query(
        "delete from otp_challenges where email_normalized = any($1::text[])",
        [emails],
      );
    }
    await cleanupDb.pool.query(
      "delete from auth_events where request_id like $1",
      [`coupon-routes-${runId}-%`],
    );
  };

  t.after(async () => {
    await harness.close();
    await purge();
    await cleanupDb.pool.end();
  });

  const call = (
    method: string,
    path: string,
    { body, token }: { body?: object; token?: string } = {},
  ) =>
    fetch(`${harness.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-request-id": `coupon-routes-${runId}-${requestSequence++}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Signs a user in through the real OTP flow. */
  const signIn = async (label: string) => {
    const email = `coupon-routes-${label}-${runId}@example.test`;
    emails.push(email);

    const requested = await call("POST", "/auth/otp/request", {
      body: { email },
    });
    assert.equal(requested.status, 200);
    const { challengeId } = (await requested.json()) as OtpRequestResponse;

    const verified = await call("POST", "/auth/otp/verify", {
      body: { email, challengeId, token: "123456" },
    });
    assert.equal(verified.status, 200);
    const session = (await verified.json()) as OtpVerifyResponse;
    userIds.push(session.user.id);
    return { token: session.session.accessToken, userId: session.user.id };
  };

  const createTendero = async (label: string) => {
    const { token, userId } = await signIn(label);
    const created = await call("POST", "/api/v1/tenderos/stores", {
      token,
      body: { name: `Tienda ${label}` },
    });
    assert.equal(created.status, 201);
    const store = ((await created.json()) as { data: Store }).data;
    return { token, userId, storeId: store.id };
  };

  /** A store-private product (`products`), reachable through its own route. */
  const createPrivateProduct = async (
    token: string,
    storeId: string,
    name: string,
    categoryId?: string,
  ): Promise<CouponProductRef> => {
    const response = await call(
      "POST",
      `/api/v1/tenderos/stores/${storeId}/products`,
      {
        token,
        body: {
          name,
          price: 1.25,
          stock: 5,
          ...(categoryId === undefined ? {} : { categoryId }),
        },
      },
    );
    assert.equal(response.status, 201);
    const product = ((await response.json()) as { data: { id: string } }).data;
    return { source: "store_private", productId: product.id };
  };

  /** A store-authored product category (`store_product_categories`). */
  const createStoreCategory = async (
    token: string,
    storeId: string,
    name: string,
  ): Promise<string> => {
    const response = await call(
      "POST",
      `/api/v1/tenderos/stores/${storeId}/product-categories`,
      { token, body: { name } },
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: { id: string } }).data.id;
  };

  /**
   * A global-catalog assignment (`store_catalog_products`). The global catalog
   * has no tendero-facing creation route, so the three catalog rows behind the
   * assignment are inserted directly and purged by slug.
   */
  const createCatalogProduct = async (
    storeId: string,
    commercialName: string,
  ): Promise<CouponProductRef> => {
    const { rows: categories } = await cleanupDb.pool.query<{ id: string }>(
      "insert into catalog_categories (name, slug) values ($1, $2) on conflict (slug) do update set name = excluded.name returning id",
      [`Coupon routes category ${runId}`, catalogSlug],
    );
    const { rows: brands } = await cleanupDb.pool.query<{ id: string }>(
      "insert into catalog_brands (name) values ($1) on conflict (name) do update set name = excluded.name returning id",
      [`Coupon routes brand ${runId}`],
    );
    const { rows: products } = await cleanupDb.pool.query<{ id: string }>(
      "insert into catalog_products (category_id, brand_id, commercial_name) values ($1, $2, $3) returning id",
      [categories[0]?.id, brands[0]?.id, commercialName],
    );
    const { rows: assignments } = await cleanupDb.pool.query<{ id: string }>(
      "insert into store_catalog_products (store_id, product_id, price) values ($1, $2, '1.50') returning id",
      [storeId, products[0]?.id],
    );
    return {
      source: "store_catalog",
      productId: assignments[0]?.id as string,
    };
  };

  const listCoupons = async (token: string, storeId: string) => {
    const response = await call(
      "GET",
      `/api/v1/tenderos/stores/${storeId}/coupons`,
      { token },
    );
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: Coupon[] }).data;
  };

  const countStoredCoupons = async (storeId: string) => {
    const { rows } = await cleanupDb.pool.query<{ count: string }>(
      "select count(*)::text as count from coupons where store_id = $1",
      [storeId],
    );
    return Number(rows[0]?.count ?? 0);
  };

  const countStoredCouponProducts = async (storeId: string) => {
    const { rows } = await cleanupDb.pool.query<{ count: string }>(
      "select count(*)::text as count from coupon_products where coupon_id in (select id from coupons where store_id = $1)",
      [storeId],
    );
    return Number(rows[0]?.count ?? 0);
  };

  // A run that crashed before its teardown must not poison this one.
  await purge();

  const owner = await createTendero("owner");
  const intruder = await createTendero("intruder");
  const customer = await signIn("customer");
  // The role is read from the database on every request, so flipping the row
  // is enough to get a `client` caller without a second app instance.
  await cleanupDb.pool.query(
    "update users set role_id = (select id from roles where name = 'client') where id = $1",
    [customer.userId],
  );

  const ownerPrivate = await createPrivateProduct(
    owner.token,
    owner.storeId,
    "Arroz 1kg",
  );
  const ownerPrivateTwo = await createPrivateProduct(
    owner.token,
    owner.storeId,
    "Fideo 400g",
  );
  const ownerPrivateCategorized = await createPrivateProduct(
    owner.token,
    owner.storeId,
    "Leche entera 1L",
    await createStoreCategory(
      owner.token,
      owner.storeId,
      `Coupon routes store category ${runId}`,
    ),
  );
  const ownerCatalog = await createCatalogProduct(
    owner.storeId,
    "Coupon routes product uno",
  );
  const intruderPrivate = await createPrivateProduct(
    intruder.token,
    intruder.storeId,
    "Pan intruso",
  );

  await t.test("an anonymous caller cannot reach a coupon route", async () => {
    const anonymous = [
      ["POST", `/api/v1/tenderos/stores/${owner.storeId}/coupons`],
      ["GET", `/api/v1/tenderos/stores/${owner.storeId}/coupons`],
      ["POST", `/api/v1/tenderos/stores/${owner.storeId}/coupon-image-uploads`],
      ["GET", `/api/v1/tenderos/coupons/${randomUUID()}`],
      ["PATCH", `/api/v1/tenderos/coupons/${randomUUID()}`],
      ["POST", `/api/v1/tenderos/coupons/${randomUUID()}/pause`],
      ["POST", `/api/v1/tenderos/coupons/${randomUUID()}/activate`],
      ["PUT", `/api/v1/tenderos/coupons/${randomUUID()}/image`],
    ] as const;

    for (const [method, path] of anonymous) {
      const response = await call(method, path, {
        // `fetch` refuses a body on GET, and a route that answers 401 never
        // reaches its body validation anyway.
        body:
          method === "GET"
            ? undefined
            : couponBody("free_text", [ownerPrivate]),
      });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  });

  await t.test("the client role cannot reach a coupon route", async () => {
    const created = await call(
      "POST",
      `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
      { token: customer.token, body: couponBody("free_text", [ownerPrivate]) },
    );
    assert.equal(created.status, 403);

    const listed = await call(
      "GET",
      `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
      { token: customer.token },
    );
    assert.equal(listed.status, 403);
    assert.equal(await countStoredCoupons(owner.storeId), 0);
  });

  await t.test(
    "a tendero cannot create or list coupons on another store",
    async () => {
      const created = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        {
          token: intruder.token,
          body: couponBody("free_text", [ownerPrivate]),
        },
      );
      assert.equal(created.status, 403);

      const listed = await call(
        "GET",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        { token: intruder.token },
      );
      assert.equal(listed.status, 403);

      const ticket = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupon-image-uploads`,
        {
          token: intruder.token,
          body: { contentType: "image/jpeg", contentLength: 1024 },
        },
      );
      assert.equal(ticket.status, 403);
      assert.equal(await countStoredCoupons(owner.storeId), 0);
    },
  );

  await t.test("each of the four coupon types is created", async () => {
    const expected = [
      ["free_text", { freeText: "Lleva una funda gratis" }],
      ["combo", {}],
      ["percentage", { percentageValue: 20 }],
      ["fixed_amount", { fixedAmountValue: 1.5 }],
    ] as const;

    for (const [type, values] of expected) {
      const response = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        {
          token: owner.token,
          body: couponBody(type as Coupon["type"], [ownerPrivate]),
        },
      );
      assert.equal(response.status, 201, type);
      const coupon = ((await response.json()) as { data: Coupon }).data;

      assert.equal(coupon.type, type);
      assert.equal(coupon.storeId, owner.storeId);
      assert.equal(coupon.totalStock, 10);
      assert.equal(coupon.claimedCount, 0);
      assert.equal(coupon.remainingStock, 10);
      assert.equal(coupon.paused, false);
      assert.equal(coupon.products.length, 1);
      assert.equal(coupon.products[0]?.productId, ownerPrivate.productId);
      assert.equal(coupon.products[0]?.source, "store_private");

      // Exactly the value field of its own type is set (S4).
      assert.equal(coupon.freeText, "freeText" in values ? values.freeText : null);
      assert.equal(
        coupon.percentageValue,
        "percentageValue" in values ? values.percentageValue : null,
      );
      assert.equal(
        coupon.fixedAmountValue,
        "fixedAmountValue" in values ? values.fixedAmountValue : null,
      );
    }

    assert.equal(await countStoredCoupons(owner.storeId), 4);
  });

  await t.test(
    "a 2x1 / combo coupon links two or more products of the store",
    async () => {
      const response = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        {
          token: owner.token,
          body: couponBody("combo", [
            ownerPrivate,
            ownerPrivateTwo,
            ownerCatalog,
          ]),
        },
      );
      assert.equal(response.status, 201);
      const coupon = ((await response.json()) as { data: Coupon }).data;
      assert.equal(coupon.products.length, 3);
      assert.deepEqual(
        coupon.products.map((product) => product.source).sort(),
        ["store_catalog", "store_private", "store_private"],
      );
    },
  );

  await t.test(
    "a non-combo coupon with two products is rejected",
    async () => {
      const before = await countStoredCoupons(owner.storeId);
      for (const type of ["free_text", "percentage", "fixed_amount"] as const) {
        const response = await call(
          "POST",
          `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
          {
            token: owner.token,
            body: couponBody(type, [ownerPrivate, ownerPrivateTwo]),
          },
        );
        assert.equal(response.status, 400, type);
      }
      assert.equal(await countStoredCoupons(owner.storeId), before);
    },
  );

  await t.test(
    "a product of another store is rejected and nothing is persisted",
    async () => {
      const coupons = await countStoredCoupons(owner.storeId);
      const couponProducts = await countStoredCouponProducts(owner.storeId);

      const foreign = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        {
          token: owner.token,
          body: couponBody("free_text", [intruderPrivate]),
        },
      );
      assert.equal(foreign.status, 400);

      // One foreign product inside an otherwise valid combo (S5).
      const mixedCombo = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        {
          token: owner.token,
          body: couponBody("combo", [ownerPrivate, intruderPrivate]),
        },
      );
      assert.equal(mixedCombo.status, 400);

      // A product id that exists in neither store.
      const unknown = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        {
          token: owner.token,
          body: couponBody("free_text", [
            { source: "store_private", productId: randomUUID() },
          ]),
        },
      );
      assert.equal(unknown.status, 400);

      assert.equal(await countStoredCoupons(owner.storeId), coupons);
      assert.equal(
        await countStoredCouponProducts(owner.storeId),
        couponProducts,
      );
    },
  );

  await t.test(
    "a validity window that ends before it starts is rejected",
    async () => {
      const before = await countStoredCoupons(owner.storeId);
      const response = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        {
          token: owner.token,
          body: couponBody("free_text", [ownerPrivate], {
            validFrom: VALID_TO,
            validTo: VALID_FROM,
          }),
        },
      );
      assert.equal(response.status, 400);
      assert.equal(await countStoredCoupons(owner.storeId), before);
    },
  );

  await t.test("an update cannot change the coupon type", async () => {
    const created = await call(
      "POST",
      `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
      { token: owner.token, body: couponBody("percentage", [ownerPrivate]) },
    );
    assert.equal(created.status, 201);
    const coupon = ((await created.json()) as { data: Coupon }).data;

    const changed = await call(
      "PATCH",
      `/api/v1/tenderos/coupons/${coupon.id}`,
      {
        token: owner.token,
        body: { type: "free_text", freeText: "Otro cupon" },
      },
    );
    assert.equal(changed.status, 409);

    const reread = await call("GET", `/api/v1/tenderos/coupons/${coupon.id}`, {
      token: owner.token,
    });
    assert.equal(reread.status, 200);
    const stored = ((await reread.json()) as { data: Coupon }).data;
    assert.equal(stored.type, "percentage");
    assert.equal(stored.percentageValue, 20);
    assert.equal(stored.freeText, null);

    // The restated type that DOES match is accepted.
    const updated = await call(
      "PATCH",
      `/api/v1/tenderos/coupons/${coupon.id}`,
      {
        token: owner.token,
        body: { type: "percentage", percentageValue: 35, title: "Cupon 35" },
      },
    );
    assert.equal(updated.status, 200);
    const next = ((await updated.json()) as { data: Coupon }).data;
    assert.equal(next.percentageValue, 35);
    assert.equal(next.title, "Cupon 35");
  });

  await t.test(
    "an update replaces the product set and still rejects a foreign product",
    async () => {
      const created = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        { token: owner.token, body: couponBody("combo", [ownerPrivate]) },
      );
      const coupon = ((await created.json()) as { data: Coupon }).data;

      const foreign = await call(
        "PATCH",
        `/api/v1/tenderos/coupons/${coupon.id}`,
        {
          token: owner.token,
          body: { type: "combo", products: [ownerPrivate, intruderPrivate] },
        },
      );
      assert.equal(foreign.status, 400);

      const reread = await call(
        "GET",
        `/api/v1/tenderos/coupons/${coupon.id}`,
        { token: owner.token },
      );
      const unchanged = ((await reread.json()) as { data: Coupon }).data;
      assert.deepEqual(
        unchanged.products.map((product) => product.productId),
        [ownerPrivate.productId],
      );

      const replaced = await call(
        "PATCH",
        `/api/v1/tenderos/coupons/${coupon.id}`,
        {
          token: owner.token,
          body: { type: "combo", products: [ownerPrivateTwo, ownerCatalog] },
        },
      );
      assert.equal(replaced.status, 200);
      const next = ((await replaced.json()) as { data: Coupon }).data;
      assert.deepEqual(
        next.products.map((product) => product.productId).sort(),
        [ownerPrivateTwo.productId, ownerCatalog.productId].sort(),
      );
    },
  );

  await t.test(
    "the total stock cannot drop below the claimed count",
    async () => {
      const created = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        {
          token: owner.token,
          body: couponBody("free_text", [ownerPrivate], { totalStock: 5 }),
        },
      );
      const coupon = ((await created.json()) as { data: Coupon }).data;

      // Two real claims, which is what T5 will write on the claim path.
      for (const label of ["one", "two"]) {
        await cleanupDb.pool.query(
          "insert into coupon_claims (coupon_id, customer_user_id, qr_token_hash) values ($1, $2, $3)",
          [
            coupon.id,
            label === "one" ? customer.userId : intruder.userId,
            createHash("sha256").update(`${coupon.id}-${label}`).digest("hex"),
          ],
        );
      }
      await cleanupDb.pool.query(
        "update coupons set claimed_count = 2 where id = $1",
        [coupon.id],
      );

      const lowered = await call(
        "PATCH",
        `/api/v1/tenderos/coupons/${coupon.id}`,
        { token: owner.token, body: { type: "free_text", totalStock: 1 } },
      );
      assert.equal(lowered.status, 409);

      const reread = await call(
        "GET",
        `/api/v1/tenderos/coupons/${coupon.id}`,
        { token: owner.token },
      );
      const stored = ((await reread.json()) as { data: Coupon }).data;
      assert.equal(stored.totalStock, 5);
      assert.equal(stored.claimedCount, 2);
      assert.equal(stored.remainingStock, 3);

      // Lowering it to exactly the claimed count is allowed.
      const exact = await call(
        "PATCH",
        `/api/v1/tenderos/coupons/${coupon.id}`,
        { token: owner.token, body: { type: "free_text", totalStock: 2 } },
      );
      assert.equal(exact.status, 200);
      const tight = ((await exact.json()) as { data: Coupon }).data;
      assert.equal(tight.totalStock, 2);
      assert.equal(tight.remainingStock, 0);
    },
  );

  await t.test("pausing and activating a coupon round trips", async () => {
    const created = await call(
      "POST",
      `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
      { token: owner.token, body: couponBody("free_text", [ownerPrivate]) },
    );
    const coupon = ((await created.json()) as { data: Coupon }).data;
    assert.equal(coupon.paused, false);

    const paused = await call(
      "POST",
      `/api/v1/tenderos/coupons/${coupon.id}/pause`,
      { token: owner.token },
    );
    assert.equal(paused.status, 200);
    assert.equal(((await paused.json()) as { data: Coupon }).data.paused, true);

    // Pausing twice is the same end state.
    const again = await call(
      "POST",
      `/api/v1/tenderos/coupons/${coupon.id}/pause`,
      { token: owner.token },
    );
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { data: Coupon }).data.paused, true);

    const active = await call(
      "POST",
      `/api/v1/tenderos/coupons/${coupon.id}/activate`,
      { token: owner.token },
    );
    assert.equal(active.status, 200);
    assert.equal(((await active.json()) as { data: Coupon }).data.paused, false);
  });

  await t.test(
    "a tendero cannot read or change another tendero's coupon",
    async () => {
      const created = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        { token: owner.token, body: couponBody("free_text", [ownerPrivate]) },
      );
      const coupon = ((await created.json()) as { data: Coupon }).data;

      const forbidden = [
        ["GET", `/api/v1/tenderos/coupons/${coupon.id}`, undefined],
        [
          "PATCH",
          `/api/v1/tenderos/coupons/${coupon.id}`,
          { type: "free_text", title: "Robado" },
        ],
        ["POST", `/api/v1/tenderos/coupons/${coupon.id}/pause`, undefined],
        ["POST", `/api/v1/tenderos/coupons/${coupon.id}/activate`, undefined],
        [
          "PUT",
          `/api/v1/tenderos/coupons/${coupon.id}/image`,
          { objectKey: `coupons/${intruder.storeId}/${randomUUID()}.jpg` },
        ],
      ] as const;

      for (const [method, path, body] of forbidden) {
        const response = await call(method, path, {
          token: intruder.token,
          body,
        });
        assert.equal(response.status, 403, `${method} ${path}`);
      }

      // A coupon that does not exist is a 404, not a 403.
      const missing = await call(
        "GET",
        `/api/v1/tenderos/coupons/${randomUUID()}`,
        { token: owner.token },
      );
      assert.equal(missing.status, 404);

      const reread = await call(
        "GET",
        `/api/v1/tenderos/coupons/${coupon.id}`,
        { token: owner.token },
      );
      assert.equal(
        ((await reread.json()) as { data: Coupon }).data.title,
        "Cupon free_text",
      );
    },
  );

  await t.test("listing returns only the authenticated store's coupons", async () => {
    const mine = await call(
      "POST",
      `/api/v1/tenderos/stores/${intruder.storeId}/coupons`,
      {
        token: intruder.token,
        body: couponBody("free_text", [intruderPrivate], {
          title: "Cupon del intruso",
        }),
      },
    );
    assert.equal(mine.status, 201);

    const intruderCoupons = await listCoupons(
      intruder.token,
      intruder.storeId,
    );
    assert.deepEqual(
      intruderCoupons.map((coupon) => coupon.title),
      ["Cupon del intruso"],
    );
    assert.ok(
      intruderCoupons.every((coupon) => coupon.storeId === intruder.storeId),
    );

    const ownerCoupons = await listCoupons(owner.token, owner.storeId);
    assert.ok(ownerCoupons.length > 1);
    assert.ok(ownerCoupons.every((coupon) => coupon.storeId === owner.storeId));
    assert.ok(
      ownerCoupons.every((coupon) => coupon.title !== "Cupon del intruso"),
    );
  });

  await t.test("a coupon response carries dates only, never a time", async () => {
    const [coupon] = await listCoupons(owner.token, owner.storeId);
    assert.ok(coupon);

    // S11: no creation or update timestamp reaches a screen.
    assert.deepEqual(Object.keys(coupon).sort(), [
      "claimedCount",
      "description",
      "fixedAmountValue",
      "freeText",
      "id",
      "imageUrl",
      "paused",
      "percentageValue",
      "products",
      "remainingStock",
      "storeId",
      "title",
      "totalStock",
      "type",
      "validFrom",
      "validTo",
    ]);
    assert.match(coupon.validFrom, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(coupon.validTo, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(coupon.validFrom, VALID_FROM);
    assert.equal(coupon.validTo, VALID_TO);
  });

  await t.test(
    "a product reference carries the display data the UI needs",
    async () => {
      const created = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        {
          token: owner.token,
          body: couponBody("combo", [ownerPrivate, ownerCatalog]),
        },
      );
      const coupon = ((await created.json()) as { data: Coupon }).data;

      const byId = new Map(
        coupon.products.map((product) => [product.productId, product]),
      );
      assert.equal(byId.get(ownerPrivate.productId)?.name, "Arroz 1kg");
      assert.equal(
        byId.get(ownerCatalog.productId)?.name,
        "Coupon routes product uno",
      );
      assert.deepEqual(
        Object.keys(byId.get(ownerPrivate.productId) ?? {}).sort(),
        ["category", "name", "productId", "source"],
      );
    },
  );

  await t.test(
    "a product reference carries the category the app maps an icon from",
    async () => {
      const created = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        {
          token: owner.token,
          body: couponBody("combo", [
            ownerPrivate,
            ownerPrivateCategorized,
            ownerCatalog,
          ]),
        },
      );
      assert.equal(created.status, 201);
      const coupon = ((await created.json()) as { data: Coupon }).data;
      const byId = new Map(
        coupon.products.map((product) => [product.productId, product]),
      );

      // A catalog product always has a catalog category, whose slug is the
      // stable key the app maps to an icon (S5/S10).
      const catalog = byId.get(ownerCatalog.productId)?.category;
      assert.deepEqual(Object.keys(catalog ?? {}).sort(), [
        "id",
        "key",
        "name",
      ]);
      assert.equal(catalog?.name, `Coupon routes category ${runId}`);
      assert.equal(catalog?.key, catalogSlug);

      // A store-authored category has no slug, so the key is null and the app
      // falls back to its default icon.
      const categorized = byId.get(ownerPrivateCategorized.productId)?.category;
      assert.equal(categorized?.name, `Coupon routes store category ${runId}`);
      assert.equal(categorized?.key, null);

      // A store-private product without any category carries none at all,
      // rather than an id with a missing name.
      assert.equal(byId.get(ownerPrivate.productId)?.category, null);
    },
  );

  await t.test(
    "the coupon image ticket is store prefixed and the key is validated",
    async () => {
      const created = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        { token: owner.token, body: couponBody("free_text", [ownerPrivate]) },
      );
      const coupon = ((await created.json()) as { data: Coupon }).data;
      assert.equal(coupon.imageUrl, null);

      const ticketResponse = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupon-image-uploads`,
        {
          token: owner.token,
          body: { contentType: "image/webp", contentLength: 2048 },
        },
      );
      assert.equal(ticketResponse.status, 201);
      const ticket = ((await ticketResponse.json()) as {
        data: ImageUploadTicket;
      }).data;
      assert.ok(ticket.objectKey.startsWith(`coupons/${owner.storeId}/`));
      assert.ok(ticket.objectKey.endsWith(".webp"));

      // A key outside this store's coupon prefix is refused.
      for (const objectKey of [
        `coupons/${intruder.storeId}/${randomUUID()}.jpg`,
        `stores/${owner.storeId}/${randomUUID()}.jpg`,
        `coupons/${owner.storeId}/../${intruder.storeId}/x.jpg`,
      ]) {
        const response = await call(
          "PUT",
          `/api/v1/tenderos/coupons/${coupon.id}/image`,
          { token: owner.token, body: { objectKey } },
        );
        assert.equal(response.status, 403, objectKey);
      }

      const set = await call(
        "PUT",
        `/api/v1/tenderos/coupons/${coupon.id}/image`,
        { token: owner.token, body: { objectKey: ticket.objectKey } },
      );
      assert.equal(set.status, 200);
      const withImage = ((await set.json()) as { data: Coupon }).data;
      assert.ok(withImage.imageUrl?.includes(ticket.objectKey));
    },
  );

  await t.test(
    "an update cannot smuggle in an image key from another store",
    async () => {
      const created = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        { token: owner.token, body: couponBody("free_text", [ownerPrivate]) },
      );
      const coupon = ((await created.json()) as { data: Coupon }).data;

      // The create route and `PUT .../image` both check the key; the update
      // route accepts the same field and must check it too.
      for (const objectKey of [
        `coupons/${intruder.storeId}/${randomUUID()}.jpg`,
        `stores/${owner.storeId}/${randomUUID()}.jpg`,
      ]) {
        const response = await call(
          "PATCH",
          `/api/v1/tenderos/coupons/${coupon.id}`,
          { token: owner.token, body: { type: "free_text", imageObjectKey: objectKey } },
        );
        assert.equal(response.status, 403, objectKey);
      }

      const reread = await call(
        "GET",
        `/api/v1/tenderos/coupons/${coupon.id}`,
        { token: owner.token },
      );
      assert.equal(
        ((await reread.json()) as { data: Coupon }).data.imageUrl,
        null,
      );
    },
  );

  await t.test(
    "a create cannot smuggle in an image key from another store",
    async () => {
      const before = await countStoredCoupons(owner.storeId);
      const response = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        {
          token: owner.token,
          body: couponBody("free_text", [ownerPrivate], {
            imageObjectKey: `coupons/${intruder.storeId}/${randomUUID()}.jpg`,
          }),
        },
      );
      assert.equal(response.status, 403);
      assert.equal(await countStoredCoupons(owner.storeId), before);
    },
  );

  await t.test(
    "PRESERVE: the store photo upload ticket still rejects a coupon key",
    async () => {
      // The store scope and the coupon scope stay separate: a coupon key is
      // still not registrable as a store photo.
      const ticket = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/photo-uploads`,
        {
          token: owner.token,
          body: { contentType: "image/jpeg", contentLength: 1024 },
        },
      );
      assert.equal(ticket.status, 201);
      const issued = ((await ticket.json()) as { data: ImageUploadTicket })
        .data;
      assert.ok(issued.objectKey.startsWith(`stores/${owner.storeId}/`));

      const registered = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/photos`,
        {
          token: owner.token,
          body: {
            objectKey: `coupons/${owner.storeId}/${randomUUID()}.jpg`,
            contentType: "image/jpeg",
            byteSize: 1024,
          },
        },
      );
      assert.equal(registered.status, 403);
    },
  );

  await t.test(
    "PRESERVE: the store product routes answer as before",
    async () => {
      const response = await call(
        "GET",
        `/api/v1/tenderos/stores/${owner.storeId}/products`,
        { token: owner.token },
      );
      assert.equal(response.status, 200);
      const products = ((await response.json()) as {
        data: { id: string; name: string }[];
      }).data;
      assert.deepEqual(
        products.map((product) => product.name).sort(),
        ["Arroz 1kg", "Fideo 400g", "Leche entera 1L"],
      );
    },
  );
});
