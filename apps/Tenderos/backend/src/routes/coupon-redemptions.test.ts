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
  CouponRedemption,
  CustomerClaim,
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
  serviceName: "coupon-redemption-route-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "coupon-redemption-route-tests",
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

/** Shifts a `YYYY-MM-DD` string by whole days, staying date-only (S11). */
function shiftDays(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

const REDEEM_PATH = "/api/v1/tenderos/coupon-redemptions";
const PREVIEW_PATH = "/api/v1/tenderos/coupon-redemptions/preview";

/**
 * The ONE answer for a token this tendero cannot redeem, whichever reason it
 * is. Asserted as a message and not only as a status, because the route itself
 * answers 404 when it is not mounted at all — a status alone would pass
 * vacuously.
 */
const NOT_FOUND_MESSAGE = "No claim matches this QR code.";

type StoredClaim = {
  status: string;
  redeemed_on: string | null;
  redeemed_by_user_id: string | null;
};

test("the tendero redeems a scanned QR exactly once", async (t) => {
  const harness = await startHarness();
  const cleanupDb = createDatabaseConnection(env);
  const runId = randomUUID();
  const emails: string[] = [];
  const userIds: string[] = [];
  let requestSequence = 0;

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
      [`coupon-redemptions-${runId}-%`],
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
        "x-request-id": `coupon-redemptions-${runId}-${requestSequence++}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Signs a user in through the real OTP flow. */
  const signIn = async (label: string) => {
    const email = `coupon-redemptions-${label}-${runId}@example.test`;
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
    return { token: session.session.accessToken, userId: session.user.id, email };
  };

  /**
   * The tenderos backend registers every user as a `tendero`, and the customer
   * app that will register a `client` does not exist yet (S2, L10). The role is
   * read from the database on every request, so flipping the row is the whole
   * fixture — the same path the T4 and T5 suites already use.
   */
  const signInAsCustomer = async (
    label: string,
    fullName = `Cliente ${label}`,
  ) => {
    const customer = await signIn(label);
    // C9: a customer needs an adult birth date to use the customer API, so the
    // fixture seeds one with the role.
    await cleanupDb.pool.query(
      "update users set role_id = (select id from roles where name = 'client'), birth_date = '1990-01-01' where id = $1",
      [customer.userId],
    );
    // Through the real profile route. Every customer is named here because C2
    // gates the claim on it; the ONE case about a customer with no name blanks
    // the column after the claim (see `blankName`).
    const named = await call("PATCH", "/auth/me", {
      token: customer.token,
      body: { fullName },
    });
    assert.equal(named.status, 200, await named.clone().text());
    return customer;
  };

  /**
   * Empties a customer's name AFTER their claim exists.
   *
   * C2 makes a nameless claim impossible to create through the API, but the
   * state it produces is still real: every claim made before C2 existed
   * belongs to an OTP-registered customer whose `full_name` is `''`, and that
   * is exactly the row the redemption response has to represent. There is no
   * route that empties a name (`fullName` is `min(1)`), so the fixture writes
   * the column directly.
   */
  const blankName = async (userId: string) => {
    await cleanupDb.pool.query("update users set full_name = '' where id = $1", [
      userId,
    ]);
  };

  const createTendero = async (label: string) => {
    const { token, userId } = await signIn(label);
    const created = await call("POST", "/api/v1/tenderos/stores", {
      token,
      body: { name: `Tienda ${label} ${runId}` },
    });
    assert.equal(created.status, 201);
    const store = ((await created.json()) as { data: Store }).data;
    return { token, userId, storeId: store.id };
  };

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

  const createCoupon = async (
    token: string,
    storeId: string,
    product: CouponProductRef,
    overrides: Record<string, unknown>,
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

  const claim = async (customerToken: string, couponId: string) =>
    call("POST", `/api/v1/clientes/coupons/${couponId}/claims`, {
      token: customerToken,
    });

  /** Claims a coupon and keeps the plaintext token the tendero will scan. */
  const claimed = async (customerToken: string, couponId: string) => {
    const response = await claim(customerToken, couponId);
    assert.equal(response.status, 201, await response.clone().text());
    const data = ((await response.json()) as { data: CustomerClaim }).data;
    return { id: data.id, qrToken: data.qrToken as string };
  };

  const redeem = (token: string, qrToken: string) =>
    call("POST", REDEEM_PATH, { token, body: { qrToken } });

  const preview = (token: string, qrToken: string) =>
    call("POST", PREVIEW_PATH, { token, body: { qrToken } });

  const storedClaim = async (claimId: string) => {
    const { rows } = await cleanupDb.pool.query<StoredClaim>(
      "select status, redeemed_on::text as redeemed_on, redeemed_by_user_id from coupon_claims where id = $1",
      [claimId],
    );
    return rows[0] as StoredClaim;
  };

  const storedCounters = async (couponId: string) => {
    const { rows } = await cleanupDb.pool.query<{
      claimed_count: number;
      claims: string;
    }>(
      `select c.claimed_count,
              (select count(*)::text from coupon_claims where coupon_id = c.id) as claims
         from coupons c where c.id = $1`,
      [couponId],
    );
    const row = rows[0];
    return {
      claimedCount: row?.claimed_count ?? -1,
      claims: Number(row?.claims ?? -1),
    };
  };

  const wallet = async (customerToken: string) => {
    const response = await call("GET", "/api/v1/clientes/claims", {
      token: customerToken,
    });
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
  const EXPIRED = {
    validFrom: shiftDays(today, -10),
    validTo: shiftDays(today, -1),
  };

  const owner = await createTendero("owner");
  const intruder = await createTendero("intruder");
  const customer = await signInAsCustomer("customer", "Ana María Pérez");
  const nameless = await signInAsCustomer("nameless");

  const ownerProduct = await createPrivateProduct(
    owner.token,
    owner.storeId,
    "Arroz 1kg",
    await createStoreCategory(
      owner.token,
      owner.storeId,
      `Granos ${runId}`,
    ),
  );
  const intruderProduct = await createPrivateProduct(
    intruder.token,
    intruder.storeId,
    "Pan intruso",
  );

  await t.test(
    "an anonymous caller cannot reach a redemption route",
    async () => {
      for (const path of [REDEEM_PATH, PREVIEW_PATH]) {
        const response = await call("POST", path, {
          body: { qrToken: "irrelevant" },
        });
        assert.equal(response.status, 401, path);
      }
    },
  );

  await t.test("a customer cannot redeem a coupon", async () => {
    const coupon = await createCoupon(owner.token, owner.storeId, ownerProduct, {
      ...CURRENT,
      title: `Cupon de guardas ${runId}`,
    });
    const mine = await claimed(customer.token, coupon.id);

    // The customer shows the QR; only the tendero scans it (S3).
    for (const path of [REDEEM_PATH, PREVIEW_PATH]) {
      const response = await call("POST", path, {
        token: customer.token,
        body: { qrToken: mine.qrToken },
      });
      assert.equal(response.status, 403, path);
    }
    assert.equal((await storedClaim(mine.id)).status, "claimed");
  });

  await t.test(
    "a token from another tendero's store is not found and is untouched",
    async () => {
      const coupon = await createCoupon(
        intruder.token,
        intruder.storeId,
        intruderProduct,
        { ...CURRENT, title: `Cupon ajeno ${runId}` },
      );
      const theirs = await claimed(customer.token, coupon.id);

      for (const path of [REDEEM_PATH, PREVIEW_PATH]) {
        const response = await call("POST", path, {
          token: owner.token,
          body: { qrToken: theirs.qrToken },
        });
        // 404 and not 403: the lookup key is a bearer secret, so a live token
        // of another store must read exactly like a token of no store at all.
        assert.equal(response.status, 404, path);
        assert.equal(
          ((await response.json()) as { error: string }).error,
          NOT_FOUND_MESSAGE,
          path,
        );
      }

      const stored = await storedClaim(theirs.id);
      assert.equal(stored.status, "claimed");
      assert.equal(stored.redeemed_on, null);
      assert.equal(stored.redeemed_by_user_id, null);
    },
  );

  await t.test("an unknown token is not found", async () => {
    for (const path of [REDEEM_PATH, PREVIEW_PATH]) {
      const response = await call("POST", path, {
        token: owner.token,
        body: { qrToken: randomUUID().replaceAll("-", "") },
      });
      assert.equal(response.status, 404, path);
      assert.equal(
        ((await response.json()) as { error: string }).error,
        NOT_FOUND_MESSAGE,
        path,
      );
    }
  });

  await t.test(
    "the preview shows what would be redeemed and writes nothing",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        ownerProduct,
        { ...CURRENT, title: `Cupon de vista previa ${runId}` },
      );
      const pending = await claimed(customer.token, coupon.id);
      const before = await storedCounters(coupon.id);

      const response = await preview(owner.token, pending.qrToken);
      assert.equal(response.status, 200, await response.clone().text());
      const data = ((await response.json()) as { data: CouponRedemption }).data;

      assert.equal(data.claimId, pending.id);
      assert.equal(data.status, "claimed");
      assert.equal(data.redeemedOn, null);
      assert.equal(data.coupon.id, coupon.id);
      assert.equal(data.store.id, owner.storeId);

      // Side-effect free: the claim and the counters are exactly as before.
      const stored = await storedClaim(pending.id);
      assert.equal(stored.status, "claimed");
      assert.equal(stored.redeemed_on, null);
      assert.deepEqual(await storedCounters(coupon.id), before);
    },
  );

  await t.test(
    "redeeming marks the claim redeemed without touching stock",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        ownerProduct,
        {
          ...CURRENT,
          title: `Cupon canjeable ${runId}`,
          description: "Descuento de prueba",
        },
      );
      const pending = await claimed(customer.token, coupon.id);
      const before = await storedCounters(coupon.id);

      const response = await redeem(owner.token, pending.qrToken);
      assert.equal(response.status, 200, await response.clone().text());
      const text = await response.clone().text();
      const data = ((await response.json()) as { data: CouponRedemption }).data;

      assert.equal(data.claimId, pending.id);
      assert.equal(data.status, "redeemed");
      assert.equal(data.redeemedOn, today);

      // What the confirmation screen renders: the coupon, its value, the
      // products with their categories, and the customer's first name.
      assert.equal(data.coupon.title, `Cupon canjeable ${runId}`);
      assert.equal(data.coupon.type, "percentage");
      assert.equal(data.coupon.percentageValue, 20);
      assert.equal(data.coupon.products.length, 1);
      assert.equal(data.coupon.products[0]?.name, "Arroz 1kg");
      assert.equal(data.coupon.products[0]?.category?.name, `Granos ${runId}`);
      assert.equal(data.customerName, "Ana");
      assert.equal(data.store.name, `Tienda owner ${runId}`);

      // S11 — the surname, the email and every clock time stay out of it.
      assert.equal(text.includes(customer.email), false);
      assert.equal(text.includes("Pérez"), false);
      assert.equal(/\d{2}:\d{2}/.test(text), false, text);
      assert.match(data.redeemedOn as string, /^\d{4}-\d{2}-\d{2}$/);
      assert.deepEqual(Object.keys(data).sort(), [
        "claimId",
        "coupon",
        "customerName",
        "redeemedOn",
        "status",
        "store",
      ]);
      assert.deepEqual(Object.keys(data.store).sort(), ["id", "name"]);

      // Claiming already reserved the stock; redeeming does not reserve again
      // (S8).
      assert.deepEqual(await storedCounters(coupon.id), before);
      const stored = await storedClaim(pending.id);
      assert.equal(stored.status, "redeemed");
      assert.equal(stored.redeemed_on, today);
      assert.equal(stored.redeemed_by_user_id, owner.userId);

      // Exactly once: the second scan of the same QR is a conflict, and so is
      // a preview of it.
      const again = await redeem(owner.token, pending.qrToken);
      assert.equal(again.status, 409);
      const previewed = await preview(owner.token, pending.qrToken);
      assert.equal(previewed.status, 409);
      assert.deepEqual(await storedCounters(coupon.id), before);

      // The customer's wallet tells the same story (T5).
      const entry = (await wallet(customer.token)).find(
        (item) => item.id === pending.id,
      );
      assert.equal(entry?.status, "redeemed");
      assert.equal(entry?.redeemedOn, today);
    },
  );

  await t.test("a claim on a paused coupon is still redeemable", async () => {
    const coupon = await createCoupon(owner.token, owner.storeId, ownerProduct, {
      ...CURRENT,
      title: `Cupon pausado ${runId}`,
    });
    const pending = await claimed(customer.token, coupon.id);

    const paused = await call(
      "POST",
      `/api/v1/tenderos/coupons/${coupon.id}/pause`,
      { token: owner.token },
    );
    assert.equal(paused.status, 200);

    // Pausing blocks NEW claims only; an existing claim stays redeemable up to
    // the validity end date (S6, L6).
    const response = await redeem(owner.token, pending.qrToken);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await storedClaim(pending.id)).status, "redeemed");
  });

  await t.test(
    "a claim past the validity end date is not redeemable",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        ownerProduct,
        { ...CURRENT, title: `Cupon vencido ${runId}` },
      );
      const pending = await claimed(customer.token, coupon.id);
      await cleanupDb.pool.query(
        "update coupons set valid_from = $2, valid_to = $3 where id = $1",
        [coupon.id, EXPIRED.validFrom, EXPIRED.validTo],
      );

      // The validity end date is the hard limit for a paused and for an active
      // coupon alike (S6).
      for (const path of [REDEEM_PATH, PREVIEW_PATH]) {
        const response = await call("POST", path, {
          token: owner.token,
          body: { qrToken: pending.qrToken },
        });
        assert.equal(response.status, 409, path);
      }

      const stored = await storedClaim(pending.id);
      assert.equal(stored.status, "claimed");
      assert.equal(stored.redeemed_on, null);
      assert.equal(stored.redeemed_by_user_id, null);
    },
  );

  await t.test(
    "a coupon valid through today is redeemable (S6 boundary)",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        ownerProduct,
        {
          validFrom: shiftDays(today, -3),
          validTo: today,
          title: `Cupon ultimo dia ${runId}`,
        },
      );
      const pending = await claimed(customer.token, coupon.id);
      const response = await redeem(owner.token, pending.qrToken);
      assert.equal(response.status, 200, await response.clone().text());
    },
  );

  await t.test(
    "a deactivated store blocks new claims and keeps the old ones redeemable",
    async () => {
      const closing = await createTendero("closing");
      const closingProduct = await createPrivateProduct(
        closing.token,
        closing.storeId,
        "Azucar 1kg",
      );
      const coupon = await createCoupon(
        closing.token,
        closing.storeId,
        closingProduct,
        { ...CURRENT, title: `Cupon de tienda cerrada ${runId}` },
      );
      const pending = await claimed(customer.token, coupon.id);
      const before = await storedCounters(coupon.id);

      // There is no deactivation route in the MVP, so the fixture writes the
      // column the tendero's own deactivation would write.
      await cleanupDb.pool.query(
        "update stores set active = false where id = $1",
        [closing.storeId],
      );

      // A deactivated store behaves exactly like a paused coupon (L11): no new
      // claim, and the stock is untouched by the rejection.
      const rejected = await claim(nameless.token, coupon.id);
      assert.equal(rejected.status, 409, await rejected.clone().text());
      assert.deepEqual(await storedCounters(coupon.id), before);

      // The claim made while the store was open stays redeemable.
      const response = await redeem(closing.token, pending.qrToken);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await storedClaim(pending.id)).status, "redeemed");
    },
  );

  await t.test(
    "two parallel scans of one token produce exactly one redemption",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        ownerProduct,
        { ...CURRENT, title: `Cupon simultaneo ${runId}` },
      );
      const pending = await claimed(customer.token, coupon.id);
      const before = await storedCounters(coupon.id);

      const responses = await Promise.all([
        redeem(owner.token, pending.qrToken),
        redeem(owner.token, pending.qrToken),
      ]);
      const statuses = responses.map((response) => response.status);

      assert.equal(
        statuses.filter((status) => status === 200).length,
        1,
        JSON.stringify(statuses),
      );
      assert.equal(
        statuses.filter((status) => status === 409).length,
        1,
        JSON.stringify(statuses),
      );
      assert.equal((await storedClaim(pending.id)).status, "redeemed");
      assert.deepEqual(await storedCounters(coupon.id), before);
    },
  );

  await t.test(
    "a customer who never completed a profile has no rendered name",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        ownerProduct,
        { ...CURRENT, title: `Cupon sin nombre ${runId}` },
      );
      const pending = await claimed(nameless.token, coupon.id);
      // The claim exists first, then the name goes away: the state under test
      // is a stored claim whose customer has no name (C2).
      await blankName(nameless.userId);

      const response = await redeem(owner.token, pending.qrToken);
      assert.equal(response.status, 200, await response.clone().text());
      const text = await response.clone().text();
      const data = ((await response.json()) as { data: CouponRedemption }).data;

      // An OTP-registered customer has no name until the profile step, and the
      // email is never a substitute for it.
      assert.equal(data.customerName, null);
      assert.equal(text.includes(nameless.email), false);
    },
  );

  await t.test(
    "the tendero and customer coupon routes still answer as before",
    async () => {
      const status = await call("GET", "/api/v1/tenderos/status");
      assert.equal(status.status, 200);

      const listed = await call(
        "GET",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        { token: owner.token },
      );
      assert.equal(listed.status, 200);
      const data = ((await listed.json()) as { data: Coupon[] }).data;
      assert.ok(data.length > 0);

      // An active store still accepts a new claim, so the L11 check did not
      // close the normal path.
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        ownerProduct,
        { ...CURRENT, title: `Cupon de preservacion ${runId}` },
      );
      // The named customer, because the case above left `nameless` with no
      // name and C2 would refuse its claim for that reason instead of
      // answering what this case is about.
      const response = await claim(customer.token, coupon.id);
      assert.equal(response.status, 201, await response.clone().text());
      assert.equal((await storedCounters(coupon.id)).claimedCount, 1);
    },
  );
});
