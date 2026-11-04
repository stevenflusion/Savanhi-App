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
  CustomerClaim,
  CustomerCouponFeedItem,
  CustomerStore,
  NearbyStore,
  StoreFollow,
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
  serviceName: "customer-coupons-route-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "customer-coupons-route-tests",
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

/**
 * The customer's own position. Bogota, because the feed's calendar day is
 * computed in `America/Bogota` (the one documented timezone) and no other
 * fixture in the repository sets store coordinates at all.
 */
const CUSTOMER_LAT = 4.711;
const CUSTOMER_LNG = -74.0721;

/**
 * One degree of latitude is ~111.2 km, so a latitude offset is a distance in
 * metres that needs no trigonometry to reason about in the fixture.
 */
const degreesNorth = (metres: number) => CUSTOMER_LAT + metres / 111_195;

const NEAR_METRES = 556;
const EDGE_METRES = 2_224;
const FAR_METRES = 5_560;

/** Shifts a `YYYY-MM-DD` string by whole days, staying date-only (S11). */
function shiftDays(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

type CouponBody = Record<string, unknown>;

test("customer coupon routes discover, follow and claim", async (t) => {
  const harness = await startHarness();
  const cleanupDb = createDatabaseConnection(env);
  const runId = randomUUID();
  const emails: string[] = [];
  const userIds: string[] = [];
  let requestSequence = 0;

  const purge = async () => {
    for (const userId of userIds) {
      // A claim or a follow belongs to the customer, not to the store, so both
      // directions are purged: `users` cascades the customer side and
      // `coupons` cascades the store side.
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
      [`customer-coupons-${runId}-%`],
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
        "x-request-id": `customer-coupons-${runId}-${requestSequence++}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Signs a user in through the real OTP flow. */
  const signIn = async (label: string) => {
    const email = `customer-coupons-${label}-${runId}@example.test`;
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

  /**
   * The tenderos backend registers every user as a `tendero`
   * (`defaultRegistrationRole`), and the customer app that will register a
   * `client` does not exist yet (S2). The role is read from the database on
   * every request, so flipping the row is the whole fixture — the same path
   * the T4 suite already uses to get a `client` caller.
   */
  const signInAsCustomer = async (label: string) => {
    const customer = await signIn(label);
    await cleanupDb.pool.query(
      "update users set role_id = (select id from roles where name = 'client') where id = $1",
      [customer.userId],
    );
    return customer;
  };

  const createStore = async (
    token: string,
    label: string,
    coordinates: { latitude: number; longitude: number } | null,
  ) => {
    const created = await call("POST", "/api/v1/tenderos/stores", {
      token,
      body: {
        name: `Tienda ${label} ${runId}`,
        ...(coordinates ?? {}),
      },
    });
    assert.equal(created.status, 201);
    return ((await created.json()) as { data: Store }).data.id;
  };

  const createPrivateProduct = async (
    token: string,
    storeId: string,
    name: string,
  ): Promise<CouponProductRef> => {
    const response = await call(
      "POST",
      `/api/v1/tenderos/stores/${storeId}/products`,
      { token, body: { name, price: 1.25, stock: 5 } },
    );
    assert.equal(response.status, 201);
    const product = ((await response.json()) as { data: { id: string } }).data;
    return { source: "store_private", productId: product.id };
  };

  const createCoupon = async (
    token: string,
    storeId: string,
    product: CouponProductRef,
    overrides: CouponBody,
  ): Promise<Coupon> => {
    const response = await call(
      "POST",
      `/api/v1/tenderos/stores/${storeId}/coupons`,
      {
        token,
        body: {
          type: "percentage",
          percentageValue: 20,
          title: `Cupon ${runId}`,
          totalStock: 10,
          products: [product],
          ...overrides,
        },
      },
    );
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: Coupon }).data;
  };

  const storedClaimedCount = async (couponId: string) => {
    const { rows } = await cleanupDb.pool.query<{ claimed: number }>(
      "select claimed_count as claimed from coupons where id = $1",
      [couponId],
    );
    return rows[0]?.claimed ?? -1;
  };

  const storedTokenHash = async (claimId: string) => {
    const { rows } = await cleanupDb.pool.query<{ hash: string }>(
      "select qr_token_hash as hash from coupon_claims where id = $1",
      [claimId],
    );
    return rows[0]?.hash ?? "";
  };

  const countStoredClaims = async (couponId: string) => {
    const { rows } = await cleanupDb.pool.query<{ count: string }>(
      "select count(*)::text as count from coupon_claims where coupon_id = $1",
      [couponId],
    );
    return Number(rows[0]?.count ?? 0);
  };

  const nearby = async (token: string, lat = CUSTOMER_LAT, lng = CUSTOMER_LNG) =>
    call(
      "GET",
      `/api/v1/clientes/stores/nearby?lat=${lat}&lng=${lng}`,
      { token },
    );

  const feed = async (token: string) =>
    call(
      "GET",
      `/api/v1/clientes/coupons/feed?lat=${CUSTOMER_LAT}&lng=${CUSTOMER_LNG}`,
      { token },
    );

  const readFeed = async (token: string) => {
    const response = await feed(token);
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: CustomerCouponFeedItem[] }).data;
  };

  const claim = async (token: string, couponId: string) =>
    call("POST", `/api/v1/clientes/coupons/${couponId}/claims`, { token });

  const wallet = async (token: string) => {
    const response = await call("GET", "/api/v1/clientes/claims", { token });
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: CustomerClaim[] }).data;
  };

  // A run that crashed before its teardown must not poison this one.
  await purge();

  /**
   * "Today" is read from Postgres in the documented timezone, so the fixture
   * windows are relative to the same calendar day the backend compares
   * against instead of to the host clock.
   */
  const { rows: todayRows } = await cleanupDb.pool.query<{ today: string }>(
    "select (now() at time zone 'America/Bogota')::date::text as today",
  );
  const today = todayRows[0]?.today as string;
  const CURRENT = { validFrom: shiftDays(today, -5), validTo: shiftDays(today, 5) };
  const EXPIRED = { validFrom: shiftDays(today, -10), validTo: shiftDays(today, -1) };
  const FUTURE = { validFrom: shiftDays(today, 1), validTo: shiftDays(today, 10) };

  const tendero = await signIn("tendero");
  const customer = await signInAsCustomer("customer");
  const other = await signInAsCustomer("other");

  const nearStore = await createStore(tendero.token, "near", {
    latitude: degreesNorth(NEAR_METRES),
    longitude: CUSTOMER_LNG,
  });
  const edgeStore = await createStore(tendero.token, "edge", {
    latitude: degreesNorth(EDGE_METRES),
    longitude: CUSTOMER_LNG,
  });
  const farStore = await createStore(tendero.token, "far", {
    latitude: degreesNorth(FAR_METRES),
    longitude: CUSTOMER_LNG,
  });
  const farFollowedStore = await createStore(tendero.token, "far-followed", {
    latitude: degreesNorth(FAR_METRES),
    longitude: CUSTOMER_LNG,
  });
  const noCoordinatesStore = await createStore(
    tendero.token,
    "no-coordinates",
    null,
  );

  const storeIds = {
    near: nearStore,
    edge: edgeStore,
    far: farStore,
    farFollowed: farFollowedStore,
    noCoordinates: noCoordinatesStore,
  };

  const products = {
    near: await createPrivateProduct(tendero.token, nearStore, "Arroz 1kg"),
    edge: await createPrivateProduct(tendero.token, edgeStore, "Fideo 400g"),
    far: await createPrivateProduct(tendero.token, farStore, "Pan 500g"),
    farFollowed: await createPrivateProduct(
      tendero.token,
      farFollowedStore,
      "Leche 1L",
    ),
    noCoordinates: await createPrivateProduct(
      tendero.token,
      noCoordinatesStore,
      "Cafe 250g",
    ),
  };

  const nearCoupon = await createCoupon(
    tendero.token,
    nearStore,
    products.near,
    { ...CURRENT, title: `Cupon cercano ${runId}` },
  );
  const edgeCoupon = await createCoupon(
    tendero.token,
    edgeStore,
    products.edge,
    { ...CURRENT, title: `Cupon al borde ${runId}` },
  );
  const farCoupon = await createCoupon(tendero.token, farStore, products.far, {
    ...CURRENT,
    title: `Cupon lejano ${runId}`,
  });
  const farFollowedCoupon = await createCoupon(
    tendero.token,
    farFollowedStore,
    products.farFollowed,
    { ...CURRENT, title: `Cupon lejano seguido ${runId}` },
  );
  const noCoordinatesCoupon = await createCoupon(
    tendero.token,
    noCoordinatesStore,
    products.noCoordinates,
    { ...CURRENT, title: `Cupon sin coordenadas ${runId}` },
  );

  const pausedCoupon = await createCoupon(
    tendero.token,
    edgeStore,
    products.edge,
    { ...CURRENT, paused: true, title: `Cupon pausado ${runId}` },
  );
  const expiredCoupon = await createCoupon(
    tendero.token,
    edgeStore,
    products.edge,
    { ...EXPIRED, title: `Cupon vencido ${runId}` },
  );
  const futureCoupon = await createCoupon(
    tendero.token,
    edgeStore,
    products.edge,
    { ...FUTURE, title: `Cupon futuro ${runId}` },
  );
  const exhaustedCoupon = await createCoupon(
    tendero.token,
    edgeStore,
    products.edge,
    { ...CURRENT, totalStock: 0, title: `Cupon agotado ${runId}` },
  );

  await t.test(
    "an anonymous caller cannot reach a customer route",
    async () => {
      const anonymous = [
        ["GET", `/api/v1/clientes/stores/nearby?lat=0&lng=0`],
        ["GET", `/api/v1/clientes/stores/followed`],
        ["PUT", `/api/v1/clientes/stores/${nearStore}/follow`],
        ["DELETE", `/api/v1/clientes/stores/${nearStore}/follow`],
        ["GET", `/api/v1/clientes/coupons/feed?lat=0&lng=0`],
        ["POST", `/api/v1/clientes/coupons/${nearCoupon.id}/claims`],
        ["GET", `/api/v1/clientes/claims`],
        ["POST", `/api/v1/clientes/claims/${randomUUID()}/qr`],
      ] as const;

      for (const [method, path] of anonymous) {
        const response = await call(method, path);
        assert.equal(response.status, 401, `${method} ${path}`);
      }
    },
  );

  await t.test("the tendero role cannot reach a customer route", async () => {
    const forbidden = [
      ["GET", `/api/v1/clientes/stores/nearby?lat=0&lng=0`],
      ["GET", `/api/v1/clientes/stores/followed`],
      ["PUT", `/api/v1/clientes/stores/${nearStore}/follow`],
      ["DELETE", `/api/v1/clientes/stores/${nearStore}/follow`],
      ["GET", `/api/v1/clientes/coupons/feed?lat=0&lng=0`],
      ["POST", `/api/v1/clientes/coupons/${nearCoupon.id}/claims`],
      ["GET", `/api/v1/clientes/claims`],
      ["POST", `/api/v1/clientes/claims/${randomUUID()}/qr`],
    ] as const;

    for (const [method, path] of forbidden) {
      const response = await call(method, path, { token: tendero.token });
      assert.equal(response.status, 403, `${method} ${path}`);
    }
    assert.equal(await countStoredClaims(nearCoupon.id), 0);
  });

  await t.test("the client role cannot reach a tendero route", async () => {
    const listed = await call(
      "GET",
      `/api/v1/tenderos/stores/${nearStore}/coupons`,
      { token: customer.token },
    );
    assert.equal(listed.status, 403);

    const paused = await call(
      "POST",
      `/api/v1/tenderos/coupons/${nearCoupon.id}/pause`,
      { token: customer.token },
    );
    assert.equal(paused.status, 403);
  });

  await t.test("the feed rejects coordinates out of range", async () => {
    const outOfRange = [
      "lat=91&lng=0",
      "lat=-91&lng=0",
      "lat=0&lng=181",
      "lat=0&lng=-181",
      "lat=abc&lng=0",
      "lng=0",
      "lat=0",
    ];

    for (const query of outOfRange) {
      const feedResponse = await call(
        "GET",
        `/api/v1/clientes/coupons/feed?${query}`,
        { token: customer.token },
      );
      assert.equal(feedResponse.status, 400, `feed ${query}`);

      const nearbyResponse = await call(
        "GET",
        `/api/v1/clientes/stores/nearby?${query}`,
        { token: customer.token },
      );
      assert.equal(nearbyResponse.status, 400, `nearby ${query}`);
    }
  });

  await t.test(
    "a blank coordinate is rejected and never read as the equator",
    async () => {
      // `Number("")` is `0`, so a blank parameter used to answer 200 as if the
      // customer were standing at 0,0 — a real point in the Atlantic.
      const blank = [
        "lat=&lng=",
        "lat=&lng=-74.0721",
        "lat=4.711&lng=",
        "lat=%20&lng=%09",
        "lat=0x10&lng=0",
        "lat=1e1&lng=0",
      ];

      for (const query of blank) {
        for (const route of [
          "/api/v1/clientes/stores/nearby",
          "/api/v1/clientes/coupons/feed",
        ]) {
          const response = await call("GET", `${route}?${query}`, {
            token: customer.token,
          });
          assert.equal(response.status, 400, `${route}?${query}`);
          const body = (await response.json()) as { error: string };
          assert.equal(
            body.error,
            "Invalid request payload.",
            `${route}?${query}`,
          );
        }
      }
    },
  );

  await t.test(
    "nearby returns active stores inside 3 km ordered by distance",
    async () => {
      const response = await nearby(customer.token);
      assert.equal(response.status, 200, await response.clone().text());
      const data = ((await response.json()) as { data: NearbyStore[] }).data;

      const mine = data.filter((store) =>
        Object.values(storeIds).includes(store.id),
      );
      assert.deepEqual(
        mine.map((store) => store.id),
        [storeIds.near, storeIds.edge],
      );

      const [near, edge] = mine;
      assert.ok(near && edge);
      // ~556 m and ~2224 m, allowing a metre of floating-point drift.
      assert.ok(Math.abs(near.distanceMeters - NEAR_METRES) <= 1, String(near.distanceMeters));
      assert.ok(Math.abs(edge.distanceMeters - EDGE_METRES) <= 1, String(edge.distanceMeters));
      assert.equal(near.distanceKm, 0.56);
      assert.equal(edge.distanceKm, 2.22);
      assert.equal(near.latitude, degreesNorth(NEAR_METRES));
      assert.equal(near.longitude, CUSTOMER_LNG);

      // S11 — a store the customer sees carries no timestamp at all.
      assert.deepEqual(Object.keys(near).sort(), [
        "address",
        "distanceKm",
        "distanceMeters",
        "id",
        "latitude",
        "longitude",
        "name",
      ]);
    },
  );

  await t.test("follow and unfollow are idempotent", async () => {
    const first = await call(
      "PUT",
      `/api/v1/clientes/stores/${farFollowedStore}/follow`,
      { token: customer.token },
    );
    assert.equal(first.status, 200, await first.clone().text());
    assert.deepEqual(((await first.json()) as { data: StoreFollow }).data, {
      storeId: farFollowedStore,
      following: true,
    });

    const again = await call(
      "PUT",
      `/api/v1/clientes/stores/${farFollowedStore}/follow`,
      { token: customer.token },
    );
    assert.equal(again.status, 200);
    assert.deepEqual(((await again.json()) as { data: StoreFollow }).data, {
      storeId: farFollowedStore,
      following: true,
    });

    const { rows } = await cleanupDb.pool.query<{ count: string }>(
      "select count(*)::text as count from store_follows where customer_user_id = $1 and store_id = $2",
      [customer.userId, farFollowedStore],
    );
    assert.equal(Number(rows[0]?.count), 1);

    const removed = await call(
      "DELETE",
      `/api/v1/clientes/stores/${farFollowedStore}/follow`,
      { token: customer.token },
    );
    assert.equal(removed.status, 200);
    assert.deepEqual(((await removed.json()) as { data: StoreFollow }).data, {
      storeId: farFollowedStore,
      following: false,
    });

    const removedAgain = await call(
      "DELETE",
      `/api/v1/clientes/stores/${farFollowedStore}/follow`,
      { token: customer.token },
    );
    assert.equal(removedAgain.status, 200);

    const unknown = await call(
      "PUT",
      `/api/v1/clientes/stores/${randomUUID()}/follow`,
      { token: customer.token },
    );
    assert.equal(unknown.status, 404);
  });

  await t.test("the followed stores list is scoped to the customer", async () => {
    for (const storeId of [nearStore, farFollowedStore, noCoordinatesStore]) {
      const followed = await call(
        "PUT",
        `/api/v1/clientes/stores/${storeId}/follow`,
        { token: customer.token },
      );
      assert.equal(followed.status, 200);
    }

    const response = await call("GET", "/api/v1/clientes/stores/followed", {
      token: customer.token,
    });
    assert.equal(response.status, 200, await response.clone().text());
    const data = ((await response.json()) as { data: CustomerStore[] }).data;
    assert.deepEqual(
      data.map((store) => store.id).sort(),
      [nearStore, farFollowedStore, noCoordinatesStore].sort(),
    );
    assert.deepEqual(Object.keys(data[0] as CustomerStore).sort(), [
      "address",
      "id",
      "latitude",
      "longitude",
      "name",
    ]);

    const others = await call("GET", "/api/v1/clientes/stores/followed", {
      token: other.token,
    });
    assert.equal(others.status, 200);
    assert.deepEqual(
      ((await others.json()) as { data: CustomerStore[] }).data,
      [],
    );
  });

  await t.test(
    "the feed merges nearby and followed coupons once, by distance",
    async () => {
      const data = await readFeed(customer.token);
      const expected = [
        nearCoupon.id,
        edgeCoupon.id,
        farFollowedCoupon.id,
        noCoordinatesCoupon.id,
      ];
      const mine = data.filter((item) => expected.includes(item.coupon.id));

      // Nearest first; a followed store beyond the radius still appears, and a
      // followed store without coordinates has no distance and sorts last.
      assert.deepEqual(
        mine.map((item) => item.coupon.id),
        expected,
      );
      assert.deepEqual(
        mine.map((item) => item.followed),
        [true, false, true, true],
      );
      assert.deepEqual(
        mine.map((item) => item.store.distanceKm),
        [0.56, 2.22, 5.56, null],
      );
      assert.deepEqual(
        mine.map((item) => item.claimed),
        [false, false, false, false],
      );

      // A followed store inside the radius appears once, not twice.
      assert.equal(
        data.filter((item) => item.coupon.id === nearCoupon.id).length,
        1,
      );

      const excluded = [
        farCoupon.id,
        pausedCoupon.id,
        expiredCoupon.id,
        futureCoupon.id,
        exhaustedCoupon.id,
      ];
      for (const couponId of excluded) {
        assert.equal(
          data.some((item) => item.coupon.id === couponId),
          false,
          couponId,
        );
      }

      const [first] = mine;
      assert.ok(first);
      assert.deepEqual(Object.keys(first).sort(), [
        "claimed",
        "coupon",
        "followed",
        "store",
      ]);
      // S11 — no timestamp reaches the customer, on the coupon or the store.
      assert.deepEqual(Object.keys(first.store).sort(), [
        "address",
        "distanceKm",
        "distanceMeters",
        "id",
        "latitude",
        "longitude",
        "name",
      ]);
      assert.deepEqual(Object.keys(first.coupon).sort(), [
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
      assert.equal(first.coupon.validFrom, CURRENT.validFrom);
      assert.equal(first.coupon.validTo, CURRENT.validTo);
    },
  );

  await t.test("a claim reserves stock once and issues a QR token", async () => {
    const response = await claim(customer.token, nearCoupon.id);
    assert.equal(response.status, 201, await response.clone().text());
    const claimed = ((await response.json()) as { data: CustomerClaim }).data;

    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.coupon.id, nearCoupon.id);
    assert.equal(claimed.store.id, nearStore);
    assert.equal(claimed.claimedOn, today);
    assert.equal(claimed.redeemedOn, null);
    assert.equal(claimed.coupon.claimedCount, 1);
    assert.equal(claimed.coupon.remainingStock, 9);
    assert.equal(await storedClaimedCount(nearCoupon.id), 1);

    // A high-entropy opaque token, returned exactly once in plaintext.
    const token = claimed.qrToken as string;
    assert.equal(typeof token, "string");
    assert.ok(token.length >= 32, token);
    assert.match(token, /^[A-Za-z0-9_-]+$/);

    // Only the hash is stored, so a database dump yields no redeemable QR.
    const hash = await storedTokenHash(claimed.id);
    assert.notEqual(hash, token);
    assert.equal(hash, sha256(token));

    assert.deepEqual(Object.keys(claimed).sort(), [
      "claimedOn",
      "coupon",
      "id",
      "qrToken",
      "redeemedOn",
      "status",
      "store",
    ]);
    assert.deepEqual(Object.keys(claimed.store).sort(), ["id", "name"]);
  });

  await t.test(
    "a second claim by the same customer leaves stock unchanged",
    async () => {
      const response = await claim(customer.token, nearCoupon.id);
      assert.equal(response.status, 409);
      assert.equal(await storedClaimedCount(nearCoupon.id), 1);
      assert.equal(await countStoredClaims(nearCoupon.id), 1);
    },
  );

  await t.test(
    "a paused, out-of-validity or exhausted coupon is not claimable",
    async () => {
      const rejected = [pausedCoupon, expiredCoupon, futureCoupon, exhaustedCoupon];

      for (const coupon of rejected) {
        const response = await claim(customer.token, coupon.id);
        assert.equal(response.status, 409, `${coupon.title}`);
        assert.equal(await storedClaimedCount(coupon.id), 0, coupon.title);
        assert.equal(await countStoredClaims(coupon.id), 0, coupon.title);
      }

      const unknown = await claim(customer.token, randomUUID());
      assert.equal(unknown.status, 404);
    },
  );

  await t.test(
    "concurrent claims on a single unit never oversell",
    async () => {
      const scarce = await createCoupon(
        tendero.token,
        edgeStore,
        products.edge,
        { ...CURRENT, totalStock: 1, title: `Cupon escaso ${runId}` },
      );
      const racers = await Promise.all(
        [0, 1, 2, 3, 4].map((index) => signInAsCustomer(`racer-${index}`)),
      );

      const responses = await Promise.all(
        racers.map((racer) => claim(racer.token, scarce.id)),
      );
      const statuses = responses.map((response) => response.status);

      assert.equal(
        statuses.filter((status) => status === 201).length,
        1,
        JSON.stringify(statuses),
      );
      assert.equal(
        statuses.filter((status) => status === 409).length,
        4,
        JSON.stringify(statuses),
      );
      assert.equal(await storedClaimedCount(scarce.id), 1);
      assert.equal(await countStoredClaims(scarce.id), 1);
    },
  );

  await t.test("the feed marks a coupon the customer already claimed", async () => {
    const data = await readFeed(customer.token);
    const item = data.find((entry) => entry.coupon.id === nearCoupon.id);
    assert.ok(item);
    assert.equal(item.claimed, true);
    assert.equal(item.coupon.remainingStock, 9);

    // Another customer has not claimed it.
    const otherData = await readFeed(other.token);
    const otherItem = otherData.find(
      (entry) => entry.coupon.id === nearCoupon.id,
    );
    assert.ok(otherItem);
    assert.equal(otherItem.claimed, false);
    assert.equal(otherItem.followed, false);
  });

  await t.test(
    "the wallet lists only my claims and derives the expired status",
    async () => {
      const walletCoupon = await createCoupon(
        tendero.token,
        edgeStore,
        products.edge,
        { ...CURRENT, title: `Cupon de billetera ${runId}` },
      );
      const created = await claim(customer.token, walletCoupon.id);
      assert.equal(created.status, 201);
      const walletClaim = ((await created.json()) as { data: CustomerClaim })
        .data;

      // The validity end date is the hard limit (S6), so an unredeemed claim
      // shows as expired once it passes — without any stored status change.
      await cleanupDb.pool.query(
        "update coupons set valid_from = $2, valid_to = $3 where id = $1",
        [walletCoupon.id, EXPIRED.validFrom, EXPIRED.validTo],
      );

      const mine = await wallet(customer.token);
      const expired = mine.find((entry) => entry.id === walletClaim.id);
      const active = mine.find((entry) => entry.coupon.id === nearCoupon.id);
      assert.ok(expired && active);
      assert.equal(expired.status, "expired");
      assert.equal(active.status, "claimed");
      // The stored status never became `expired`; it is derived on read.
      const { rows } = await cleanupDb.pool.query<{ status: string }>(
        "select status from coupon_claims where id = $1",
        [walletClaim.id],
      );
      assert.equal(rows[0]?.status, "claimed");

      // The plaintext token lives only in the response that issued it.
      assert.equal(expired.qrToken, null);
      assert.equal(active.qrToken, null);

      // S11 — date-only, and no timestamp anywhere in a wallet entry.
      assert.match(expired.claimedOn, /^\d{4}-\d{2}-\d{2}$/);
      assert.deepEqual(Object.keys(expired).sort(), [
        "claimedOn",
        "coupon",
        "id",
        "qrToken",
        "redeemedOn",
        "status",
        "store",
      ]);

      const theirs = await wallet(other.token);
      assert.equal(
        theirs.some((entry) => entry.id === walletClaim.id),
        false,
      );
    },
  );

  await t.test("a QR token is rotated only by its own owner", async () => {
    const rotatable = await createCoupon(
      tendero.token,
      edgeStore,
      products.edge,
      { ...CURRENT, title: `Cupon rotable ${runId}` },
    );
    const created = await claim(customer.token, rotatable.id);
    assert.equal(created.status, 201);
    const original = ((await created.json()) as { data: CustomerClaim }).data;
    const originalToken = original.qrToken as string;

    const stolen = await call(
      "POST",
      `/api/v1/clientes/claims/${original.id}/qr`,
      { token: other.token },
    );
    assert.equal(stolen.status, 403);
    assert.equal(await storedTokenHash(original.id), sha256(originalToken));

    const unknown = await call(
      "POST",
      `/api/v1/clientes/claims/${randomUUID()}/qr`,
      { token: customer.token },
    );
    assert.equal(unknown.status, 404);

    const rotated = await call(
      "POST",
      `/api/v1/clientes/claims/${original.id}/qr`,
      { token: customer.token },
    );
    assert.equal(rotated.status, 200, await rotated.clone().text());
    const reissued = ((await rotated.json()) as { data: CustomerClaim }).data;
    const newToken = reissued.qrToken as string;

    assert.equal(reissued.id, original.id);
    assert.notEqual(newToken, originalToken);
    assert.equal(await storedTokenHash(original.id), sha256(newToken));
    // The old token no longer matches anything stored, so it is dead.
    assert.notEqual(await storedTokenHash(original.id), sha256(originalToken));
    // Rotating issues a token, it does not claim again.
    assert.equal(await storedClaimedCount(rotatable.id), 1);
  });

  await t.test(
    "a redeemed or expired claim cannot be rotated",
    async () => {
      const redeemable = await createCoupon(
        tendero.token,
        edgeStore,
        products.edge,
        { ...CURRENT, title: `Cupon canjeado ${runId}` },
      );
      const created = await claim(customer.token, redeemable.id);
      assert.equal(created.status, 201);
      const redeemed = ((await created.json()) as { data: CustomerClaim }).data;

      // T6 owns the redeem route; the stored end state is written directly so
      // this rule is provable now.
      await cleanupDb.pool.query(
        "update coupon_claims set status = 'redeemed', redeemed_on = $2, redeemed_by_user_id = $3 where id = $1",
        [redeemed.id, today, tendero.userId],
      );
      const afterRedeem = await call(
        "POST",
        `/api/v1/clientes/claims/${redeemed.id}/qr`,
        { token: customer.token },
      );
      assert.equal(afterRedeem.status, 409);

      const expiring = await createCoupon(
        tendero.token,
        edgeStore,
        products.edge,
        { ...CURRENT, title: `Cupon por vencer ${runId}` },
      );
      const claimedBeforeExpiry = await claim(customer.token, expiring.id);
      assert.equal(claimedBeforeExpiry.status, 201);
      const expiringClaim = (
        (await claimedBeforeExpiry.json()) as { data: CustomerClaim }
      ).data;
      await cleanupDb.pool.query(
        "update coupons set valid_from = $2, valid_to = $3 where id = $1",
        [expiring.id, EXPIRED.validFrom, EXPIRED.validTo],
      );
      const afterExpiry = await call(
        "POST",
        `/api/v1/clientes/claims/${expiringClaim.id}/qr`,
        { token: customer.token },
      );
      assert.equal(afterExpiry.status, 409);

      const stored = await wallet(customer.token);
      assert.equal(
        stored.find((entry) => entry.id === redeemed.id)?.status,
        "redeemed",
      );
    },
  );

  await t.test(
    "a coupon valid through today is still claimable (S6 boundary)",
    async () => {
      const lastDay = await createCoupon(
        tendero.token,
        edgeStore,
        products.edge,
        {
          validFrom: shiftDays(today, -3),
          validTo: today,
          title: `Cupon ultimo dia ${runId}`,
        },
      );
      const response = await claim(other.token, lastDay.id);
      assert.equal(response.status, 201, await response.clone().text());
      assert.equal(await storedClaimedCount(lastDay.id), 1);

      const firstDay = await createCoupon(
        tendero.token,
        edgeStore,
        products.edge,
        {
          validFrom: today,
          validTo: shiftDays(today, 3),
          title: `Cupon primer dia ${runId}`,
        },
      );
      const alsoClaimable = await claim(other.token, firstDay.id);
      assert.equal(alsoClaimable.status, 201);
    },
  );

  await t.test(
    "the tendero coupon routes still answer as before",
    async () => {
      const listed = await call(
        "GET",
        `/api/v1/tenderos/stores/${nearStore}/coupons`,
        { token: tendero.token },
      );
      assert.equal(listed.status, 200);
      const data = ((await listed.json()) as { data: Coupon[] }).data;
      assert.deepEqual(
        data.map((coupon) => coupon.id),
        [nearCoupon.id],
      );
      assert.equal(data[0]?.claimedCount, 1);

      const status = await call("GET", "/api/v1/tenderos/status");
      assert.equal(status.status, 200);
    },
  );
});
