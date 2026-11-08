import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  CustomerCouponFeedItem,
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
  serviceName: "customer-feed-location-route-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "customer-feed-location-route-tests",
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

/** Bogota, the documented coupon calendar zone (T5). */
const CUSTOMER_LAT = 4.711;
const CUSTOMER_LNG = -74.0721;
/** One degree of latitude is ~111.2 km, so an offset is a distance. */
const degreesNorth = (metres: number) => CUSTOMER_LAT + metres / 111_195;
const NEAR_METRES = 556;
const FAR_METRES = 5_560;

/** Shifts a `YYYY-MM-DD` string by whole days, staying date-only (S11). */
function shiftDays(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * C3 — discovery when the customer denied the location permission. The feed
 * accepts no coordinates at all and answers the followed half of the one feed
 * (S7); half a position, and the L13 spellings that are not positions, stay a
 * 400.
 */
test("the coupon feed answers without coordinates", async (t) => {
  const harness = await startHarness();
  const cleanupDb = createDatabaseConnection(env);
  const runId = randomUUID();
  const emails: string[] = [];
  const userIds: string[] = [];
  let requestSequence = 0;

  const purge = async () => {
    for (const userId of userIds) {
      await cleanupDb.pool.query(
        "delete from coupons where store_id in (select id from stores where owner_user_id = $1)",
        [userId],
      );
      await cleanupDb.pool.query(
        "delete from products where store_id in (select id from stores where owner_user_id = $1)",
        [userId],
      );
      await cleanupDb.pool.query("delete from stores where owner_user_id = $1", [
        userId,
      ]);
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
      [`customer-feed-location-${runId}-%`],
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
        "x-request-id": `customer-feed-location-${runId}-${requestSequence++}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const signIn = async (label: string) => {
    const email = `customer-feed-location-${label}-${runId}@example.test`;
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
   * The role is read from the database on every request, so flipping the row is
   * the whole fixture — the same path the T4–T7 suites use. C1 adds a real
   * registration path; this suite deliberately does not depend on it, so a
   * failure here is about the feed and nothing else.
   */
  const signInAsCustomer = async (label: string) => {
    const customer = await signIn(label);
    // C9: a customer needs an adult birth date to use the customer API, so the
    // fixture seeds one with the role.
    await cleanupDb.pool.query(
      "update users set role_id = (select id from roles where name = 'client'), birth_date = '1990-01-01' where id = $1",
      [customer.userId],
    );
    return customer;
  };

  const createStore = async (
    token: string,
    label: string,
    coordinates: { latitude: number; longitude: number },
  ) => {
    const created = await call("POST", "/api/v1/tenderos/stores", {
      token,
      body: { name: `Tienda ${label} ${runId}`, ...coordinates },
    });
    assert.equal(created.status, 201, await created.clone().text());
    return ((await created.json()) as { data: Store }).data.id;
  };

  const createCoupon = async (
    token: string,
    storeId: string,
    title: string,
  ): Promise<Coupon> => {
    const createdProduct = await call(
      "POST",
      `/api/v1/tenderos/stores/${storeId}/products`,
      { token, body: { name: `Producto ${title}`, price: 1.25, stock: 5 } },
    );
    assert.equal(createdProduct.status, 201);
    const product: CouponProductRef = {
      source: "store_private",
      productId: ((await createdProduct.json()) as { data: { id: string } })
        .data.id,
    };

    const created = await call(
      "POST",
      `/api/v1/tenderos/stores/${storeId}/coupons`,
      {
        token,
        body: {
          type: "percentage",
          percentageValue: 15,
          title,
          totalStock: 10,
          validFrom: shiftDays(today, -2),
          validTo: shiftDays(today, 5),
          paused: false,
          products: [product],
        },
      },
    );
    assert.equal(created.status, 201, await created.clone().text());
    return ((await created.json()) as { data: Coupon }).data;
  };

  const feed = (token: string, query: string) =>
    call("GET", `/api/v1/clientes/coupons/feed${query}`, { token });

  const readFeed = async (token: string, query: string) => {
    const response = await feed(token, query);
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: CustomerCouponFeedItem[] }).data;
  };

  await purge();

  const { rows: todayRows } = await cleanupDb.pool.query<{ today: string }>(
    "select (now() at time zone 'America/Bogota')::date::text as today",
  );
  const today = todayRows[0]?.today as string;

  const nearTendero = await signIn("near-owner");
  const farTendero = await signIn("far-owner");
  const customer = await signInAsCustomer("customer");

  const nearStore = await createStore(nearTendero.token, "cerca", {
    latitude: degreesNorth(NEAR_METRES),
    longitude: CUSTOMER_LNG,
  });
  const farStore = await createStore(farTendero.token, "lejos", {
    latitude: degreesNorth(FAR_METRES),
    longitude: CUSTOMER_LNG,
  });

  const nearCoupon = await createCoupon(
    nearTendero.token,
    nearStore,
    `Cupon cerca ${runId}`,
  );
  const farCoupon = await createCoupon(
    farTendero.token,
    farStore,
    `Cupon lejos ${runId}`,
  );

  const followed = await call(
    "PUT",
    `/api/v1/clientes/stores/${farStore}/follow`,
    { token: customer.token },
  );
  assert.equal(followed.status, 200, await followed.clone().text());

  /** Only this run's coupons; the development database holds other rows. */
  const ours = (items: CustomerCouponFeedItem[]) =>
    items.filter((item) =>
      [nearCoupon.id, farCoupon.id].includes(item.coupon.id),
    );

  await t.test(
    "with no coordinates the feed is the followed stores only",
    async () => {
      const items = ours(await readFeed(customer.token, ""));

      assert.deepEqual(
        items.map((item) => item.coupon.id),
        [farCoupon.id],
      );
      const [item] = items;
      assert.ok(item);
      assert.equal(item.followed, true);
      assert.equal(item.store.distanceMeters, null);
      assert.equal(item.store.distanceKm, null);
      assert.equal(item.store.id, farStore);
      assert.equal(item.claimed, false);
      // The feed item keeps its four keys: this is the one feed (S7), not a
      // second endpoint with a different shape.
      assert.deepEqual(Object.keys(item).sort(), [
        "claimed",
        "coupon",
        "followed",
        "store",
      ]);
    },
  );

  await t.test("half a position is not a position", async () => {
    for (const query of [
      `?lat=${CUSTOMER_LAT}`,
      `?lng=${CUSTOMER_LNG}`,
    ]) {
      const response = await feed(customer.token, query);
      assert.equal(response.status, 400, `${query}: ${await response.clone().text()}`);
      const body = (await response.json()) as { error: string };
      assert.equal(body.error, "Invalid request payload.");
    }
  });

  await t.test(
    "a blank or non-decimal coordinate is still rejected (PRESERVE L13)",
    async () => {
      for (const query of [
        "?lat=&lng=",
        `?lat=&lng=${CUSTOMER_LNG}`,
        `?lat=%20&lng=${CUSTOMER_LNG}`,
        `?lat=1e1&lng=${CUSTOMER_LNG}`,
        `?lat=0x10&lng=${CUSTOMER_LNG}`,
        `?lat=91&lng=${CUSTOMER_LNG}`,
        `?lat=${CUSTOMER_LAT}&lng=${CUSTOMER_LNG}&radius=5000`,
      ]) {
        const response = await feed(customer.token, query);
        assert.equal(
          response.status,
          400,
          `${query}: ${await response.clone().text()}`,
        );
      }
    },
  );

  await t.test(
    "the full pair still answers both halves of the feed (PRESERVE)",
    async () => {
      const items = ours(
        await readFeed(
          customer.token,
          `?lat=${CUSTOMER_LAT}&lng=${CUSTOMER_LNG}`,
        ),
      );

      assert.deepEqual(
        items.map((item) => item.coupon.id),
        [nearCoupon.id, farCoupon.id],
      );
      assert.deepEqual(
        items.map((item) => item.followed),
        [false, true],
      );
      for (const item of items) {
        assert.ok(
          typeof item.store.distanceMeters === "number" &&
            item.store.distanceMeters > 0,
          JSON.stringify(item.store),
        );
      }
    },
  );

  await t.test(
    "the nearby route still requires coordinates (PRESERVE)",
    async () => {
      const missing = await call("GET", "/api/v1/clientes/stores/nearby", {
        token: customer.token,
      });
      assert.equal(missing.status, 400, await missing.clone().text());

      const present = await call(
        "GET",
        `/api/v1/clientes/stores/nearby?lat=${CUSTOMER_LAT}&lng=${CUSTOMER_LNG}`,
        { token: customer.token },
      );
      assert.equal(present.status, 200, await present.clone().text());
    },
  );
});
