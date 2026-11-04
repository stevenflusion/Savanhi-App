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
  CustomerClaim,
  StoreMetrics,
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
  serviceName: "customer-claim-release-route-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "customer-claim-release-route-tests",
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

const REDEEM_PATH = "/api/v1/tenderos/coupon-redemptions";
const PREVIEW_PATH = "/api/v1/tenderos/coupon-redemptions/preview";

const RELEASED_MESSAGE = "This claim was released and is no longer valid.";
const ALREADY_RELEASED_MESSAGE = "This claim was already released.";
const RECLAIM_MESSAGE =
  "You already released this coupon and cannot claim it again.";

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

/**
 * C4 — releasing a claim. The rules this suite proves are all about stored
 * state under concurrency, so every case goes through the public HTTP surface
 * against live Postgres and reads the columns back directly.
 */
test("a customer can release a claim exactly once", async (t) => {
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
      [`customer-claim-release-${runId}-%`],
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
        "x-request-id": `customer-claim-release-${runId}-${requestSequence++}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const signIn = async (label: string) => {
    const email = `customer-claim-release-${label}-${runId}@example.test`;
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
   * The role is flipped in the database, as every T4–T7 suite does, so this
   * suite does not depend on C1. The name is saved through the real profile
   * route because C2 gates the claim on it.
   */
  const signInAsCustomer = async (label: string, fullName: string) => {
    const customer = await signIn(label);
    await cleanupDb.pool.query(
      "update users set role_id = (select id from roles where name = 'client') where id = $1",
      [customer.userId],
    );
    const named = await call("PATCH", "/auth/me", {
      token: customer.token,
      body: { fullName },
    });
    assert.equal(named.status, 200, await named.clone().text());
    return customer;
  };

  const createTendero = async (label: string) => {
    const owner = await signIn(label);
    const created = await call("POST", "/api/v1/tenderos/stores", {
      token: owner.token,
      body: { name: `Tienda ${label} ${runId}` },
    });
    assert.equal(created.status, 201, await created.clone().text());
    const store = ((await created.json()) as { data: Store }).data;
    return { ...owner, storeId: store.id };
  };

  const createCoupon = async (
    token: string,
    storeId: string,
    title: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Coupon> => {
    const createdProduct = await call(
      "POST",
      `/api/v1/tenderos/stores/${storeId}/products`,
      { token, body: { name: `Producto ${title}`, price: 1.25, stock: 9 } },
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
          percentageValue: 20,
          title,
          totalStock: 5,
          validFrom: shiftDays(today, -2),
          validTo: shiftDays(today, 5),
          paused: false,
          products: [product],
          ...overrides,
        },
      },
    );
    assert.equal(created.status, 201, await created.clone().text());
    return ((await created.json()) as { data: Coupon }).data;
  };

  const claim = (token: string, couponId: string) =>
    call("POST", `/api/v1/clientes/coupons/${couponId}/claims`, { token });

  const claimed = async (token: string, couponId: string) => {
    const response = await claim(token, couponId);
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: CustomerClaim }).data;
  };

  const release = (token: string, claimId: string) =>
    call("POST", `/api/v1/clientes/claims/${claimId}/release`, { token });

  const reissue = (token: string, claimId: string) =>
    call("POST", `/api/v1/clientes/claims/${claimId}/qr`, { token });

  const redeem = (token: string, qrToken: string) =>
    call("POST", REDEEM_PATH, { token, body: { qrToken } });

  const preview = (token: string, qrToken: string) =>
    call("POST", PREVIEW_PATH, { token, body: { qrToken } });

  const wallet = async (token: string) => {
    const response = await call("GET", "/api/v1/clientes/claims", { token });
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: CustomerClaim[] }).data;
  };

  const storedCoupon = async (couponId: string) => {
    const { rows } = await cleanupDb.pool.query<{
      claimed: number;
      claims: string;
    }>(
      `select claimed_count as claimed,
              (select count(*)::text from coupon_claims where coupon_id = coupons.id) as claims
         from coupons where id = $1`,
      [couponId],
    );
    return {
      claimedCount: rows[0]?.claimed ?? -1,
      claimRows: Number(rows[0]?.claims ?? -1),
    };
  };

  const storedClaim = async (claimId: string) => {
    const { rows } = await cleanupDb.pool.query<{
      status: string;
      released_on: string | null;
      redeemed_on: string | null;
    }>(
      "select status, released_on::text, redeemed_on::text from coupon_claims where id = $1",
      [claimId],
    );
    return rows[0] ?? null;
  };

  await purge();

  const { rows: todayRows } = await cleanupDb.pool.query<{ today: string }>(
    "select (now() at time zone 'America/Bogota')::date::text as today",
  );
  const today = todayRows[0]?.today as string;

  const owner = await createTendero("owner");
  const customer = await signInAsCustomer("customer", "Camila Vega");
  const other = await signInAsCustomer("other", "Andrés Pazmiño");

  await t.test("anonymous and tendero callers cannot release", async () => {
    const coupon = await createCoupon(
      owner.token,
      owner.storeId,
      `Cupon guardia ${runId}`,
    );
    const taken = await claimed(customer.token, coupon.id);

    const anonymous = await call(
      "POST",
      `/api/v1/clientes/claims/${taken.id}/release`,
    );
    assert.equal(anonymous.status, 401, await anonymous.clone().text());
    assert.deepEqual(await anonymous.json(), {
      error: "Missing access token.",
    });

    const tendero = await release(owner.token, taken.id);
    assert.equal(tendero.status, 403, await tendero.clone().text());
    assert.deepEqual(await tendero.json(), {
      error: "You do not have access to this resource.",
    });

    const foreign = await release(other.token, taken.id);
    assert.equal(foreign.status, 403, await foreign.clone().text());
    assert.deepEqual(await foreign.json(), {
      error: "This claim belongs to another customer.",
    });

    const unknown = await release(customer.token, randomUUID());
    assert.equal(unknown.status, 404, await unknown.clone().text());
    assert.deepEqual(await unknown.json(), { error: "Claim not found." });

    const malformed = await release(customer.token, "not-a-uuid");
    assert.equal(malformed.status, 400, await malformed.clone().text());

    // Not one of those rejections touched the reservation.
    assert.deepEqual(await storedCoupon(coupon.id), {
      claimedCount: 1,
      claimRows: 1,
    });
  });

  await t.test("a release returns the unit to stock exactly once", async () => {
    const coupon = await createCoupon(
      owner.token,
      owner.storeId,
      `Cupon liberado ${runId}`,
    );
    const taken = await claimed(customer.token, coupon.id);
    assert.deepEqual(await storedCoupon(coupon.id), {
      claimedCount: 1,
      claimRows: 1,
    });

    const response = await release(customer.token, taken.id);
    assert.equal(response.status, 200, await response.clone().text());
    const data = ((await response.json()) as { data: CustomerClaim }).data;

    assert.equal(data.id, taken.id);
    assert.equal(data.status, "released");
    assert.equal(data.qrToken, null);
    assert.equal(data.redeemedOn, null);
    // The customer response keeps its seven keys: `released` is a derived
    // status, not a new field (S11 — no new date reaches a screen).
    assert.deepEqual(Object.keys(data).sort(), [
      "claimedOn",
      "coupon",
      "id",
      "qrToken",
      "redeemedOn",
      "status",
      "store",
    ]);

    // The row survives as data, the reservation does not.
    assert.deepEqual(await storedCoupon(coupon.id), {
      claimedCount: 0,
      claimRows: 1,
    });
    const stored = await storedClaim(taken.id);
    assert.equal(stored?.status, "claimed");
    assert.equal(stored?.released_on, today);
    assert.equal(stored?.redeemed_on, null);

    // And the wallet says so instead of hiding the claim.
    const entry = (await wallet(customer.token)).find(
      (item) => item.id === taken.id,
    );
    assert.equal(entry?.status, "released");
    assert.equal(entry?.qrToken, null);
    assert.equal(entry?.coupon.remainingStock, coupon.totalStock);
  });

  await t.test(
    "the released QR stops working in preview, redeem and re-issue",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        `Cupon qr muerto ${runId}`,
      );
      const taken = await claimed(customer.token, coupon.id);
      assert.ok(taken.qrToken);

      const released = await release(customer.token, taken.id);
      assert.equal(released.status, 200, await released.clone().text());

      const previewed = await preview(owner.token, taken.qrToken as string);
      assert.equal(previewed.status, 409, await previewed.clone().text());
      assert.deepEqual(await previewed.json(), { error: RELEASED_MESSAGE });

      const redeemed = await redeem(owner.token, taken.qrToken as string);
      assert.equal(redeemed.status, 409, await redeemed.clone().text());
      assert.deepEqual(await redeemed.json(), { error: RELEASED_MESSAGE });

      const reissued = await reissue(customer.token, taken.id);
      assert.equal(reissued.status, 409, await reissued.clone().text());
      assert.deepEqual(await reissued.json(), { error: RELEASED_MESSAGE });

      // None of the three wrote anything.
      assert.deepEqual(await storedCoupon(coupon.id), {
        claimedCount: 0,
        claimRows: 1,
      });
      const stored = await storedClaim(taken.id);
      assert.equal(stored?.status, "claimed");
      assert.equal(stored?.redeemed_on, null);
    },
  );

  await t.test("a second release never decrements twice", async () => {
    const coupon = await createCoupon(
      owner.token,
      owner.storeId,
      `Cupon doble ${runId}`,
    );
    const taken = await claimed(customer.token, coupon.id);

    assert.equal((await release(customer.token, taken.id)).status, 200);
    const again = await release(customer.token, taken.id);
    assert.equal(again.status, 409, await again.clone().text());
    assert.deepEqual(await again.json(), { error: ALREADY_RELEASED_MESSAGE });

    assert.deepEqual(await storedCoupon(coupon.id), {
      claimedCount: 0,
      claimRows: 1,
    });
  });

  await t.test(
    "two parallel releases produce one winner and one decrement",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        `Cupon paralelo ${runId}`,
      );
      const taken = await claimed(customer.token, coupon.id);

      const statuses = (
        await Promise.all([
          release(customer.token, taken.id),
          release(customer.token, taken.id),
          release(customer.token, taken.id),
        ])
      ).map((response) => response.status);

      assert.equal(
        statuses.filter((status) => status === 200).length,
        1,
        JSON.stringify(statuses),
      );
      assert.equal(
        statuses.filter((status) => status === 409).length,
        2,
        JSON.stringify(statuses),
      );
      assert.deepEqual(await storedCoupon(coupon.id), {
        claimedCount: 0,
        claimRows: 1,
      });
    },
  );

  await t.test(
    "a release racing a redemption has exactly one winner",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        `Cupon carrera ${runId}`,
      );
      const taken = await claimed(customer.token, coupon.id);

      const [releaseResponse, redeemResponse] = await Promise.all([
        release(customer.token, taken.id),
        redeem(owner.token, taken.qrToken as string),
      ]);
      const statuses = [releaseResponse.status, redeemResponse.status];
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

      // Whoever won, the stored state is one of the two consistent ones and
      // never half of each.
      const stored = await storedClaim(taken.id);
      const counters = await storedCoupon(coupon.id);
      if (releaseResponse.status === 200) {
        assert.equal(stored?.status, "claimed");
        assert.equal(stored?.released_on, today);
        assert.equal(stored?.redeemed_on, null);
        assert.equal(counters.claimedCount, 0);
      } else {
        assert.equal(stored?.status, "redeemed");
        assert.equal(stored?.released_on, null);
        assert.equal(stored?.redeemed_on, today);
        assert.equal(counters.claimedCount, 1);
      }
    },
  );

  await t.test(
    "a redeemed claim and an expired claim cannot be released",
    async () => {
      const redeemedCoupon = await createCoupon(
        owner.token,
        owner.storeId,
        `Cupon canjeado ${runId}`,
      );
      const takenRedeemed = await claimed(customer.token, redeemedCoupon.id);
      assert.equal(
        (await redeem(owner.token, takenRedeemed.qrToken as string)).status,
        200,
      );

      const refusedRedeemed = await release(customer.token, takenRedeemed.id);
      assert.equal(refusedRedeemed.status, 409, await refusedRedeemed.clone().text());
      assert.deepEqual(await refusedRedeemed.json(), {
        error: "This claim has already been redeemed.",
      });
      assert.deepEqual(await storedCoupon(redeemedCoupon.id), {
        claimedCount: 1,
        claimRows: 1,
      });

      const expiredCoupon = await createCoupon(
        owner.token,
        owner.storeId,
        `Cupon vencido ${runId}`,
      );
      const takenExpired = await claimed(customer.token, expiredCoupon.id);
      // There is no route that moves a validity window into the past, so the
      // fixture writes the columns the tendero's own edit would write.
      await cleanupDb.pool.query(
        "update coupons set valid_from = $2, valid_to = $3 where id = $1",
        [expiredCoupon.id, shiftDays(today, -10), shiftDays(today, -1)],
      );

      const refusedExpired = await release(customer.token, takenExpired.id);
      assert.equal(refusedExpired.status, 409, await refusedExpired.clone().text());
      assert.deepEqual(await refusedExpired.json(), {
        error: "This coupon is no longer valid.",
      });
      assert.deepEqual(await storedCoupon(expiredCoupon.id), {
        claimedCount: 1,
        claimRows: 1,
      });
      assert.equal((await storedClaim(takenExpired.id))?.released_on, null);
    },
  );

  await t.test(
    "the released coupon cannot be claimed again (ASSUMPTION: once per customer)",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        `Cupon reclamo ${runId}`,
      );
      const taken = await claimed(customer.token, coupon.id);
      assert.equal((await release(customer.token, taken.id)).status, 200);

      const again = await claim(customer.token, coupon.id);
      assert.equal(again.status, 409, await again.clone().text());
      assert.deepEqual(await again.json(), { error: RECLAIM_MESSAGE });
      assert.deepEqual(await storedCoupon(coupon.id), {
        claimedCount: 0,
        claimRows: 1,
      });

      // Another customer takes the unit the release put back.
      const second = await claimed(other.token, coupon.id);
      assert.ok(second.qrToken);
      assert.deepEqual(await storedCoupon(coupon.id), {
        claimedCount: 1,
        claimRows: 2,
      });
    },
  );

  await t.test(
    "the feed still reports a released coupon as claimed by this customer",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        `Cupon feed ${runId}`,
      );
      const taken = await claimed(customer.token, coupon.id);
      assert.equal((await release(customer.token, taken.id)).status, 200);

      // The store has no coordinates, so the followed half of the feed is the
      // only way to see it — which is exactly the C3 read.
      const followed = await call(
        "PUT",
        `/api/v1/clientes/stores/${owner.storeId}/follow`,
        { token: customer.token },
      );
      assert.equal(followed.status, 200, await followed.clone().text());

      const response = await call("GET", "/api/v1/clientes/coupons/feed", {
        token: customer.token,
      });
      assert.equal(response.status, 200, await response.clone().text());
      const items = (
        (await response.json()) as {
          data: { coupon: { id: string; remainingStock: number }; claimed: boolean }[];
        }
      ).data.filter((item) => item.coupon.id === coupon.id);

      assert.equal(items.length, 1, JSON.stringify(items));
      // `claimed` is "this customer already took it", not "it is in your
      // wallet": the row is still there and the re-claim is a 409.
      assert.equal(items[0]?.claimed, true);
      // And the unit is back on offer for everyone else.
      assert.equal(items[0]?.coupon.remainingStock, coupon.totalStock);

      await call("DELETE", `/api/v1/clientes/stores/${owner.storeId}/follow`, {
        token: customer.token,
      });
    },
  );

  await t.test(
    "the store metrics forget a released claim and restore its stock",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        `Cupon metricas ${runId}`,
        { totalStock: 4 },
      );
      const releasedClaim = await claimed(customer.token, coupon.id);
      const keptClaim = await claimed(other.token, coupon.id);
      assert.equal(
        (await redeem(owner.token, keptClaim.qrToken as string)).status,
        200,
      );

      const readMetrics = async () => {
        const response = await call(
          "GET",
          `/api/v1/tenderos/stores/${owner.storeId}/metrics`,
          { token: owner.token },
        );
        assert.equal(response.status, 200, await response.clone().text());
        const data = ((await response.json()) as { data: StoreMetrics }).data;
        const entry = data.coupons.find(
          (item) => item.couponId === coupon.id,
        );
        assert.ok(entry, JSON.stringify(data.coupons));
        return { data, entry };
      };

      const before = await readMetrics();
      assert.deepEqual(
        [
          before.entry.claimedCount,
          before.entry.redeemedCount,
          before.entry.remainingStock,
        ],
        [2, 1, 2],
      );

      assert.equal((await release(customer.token, releasedClaim.id)).status, 200);

      const after = await readMetrics();
      assert.deepEqual(
        [
          after.entry.claimedCount,
          after.entry.redeemedCount,
          after.entry.remainingStock,
        ],
        [1, 1, 3],
      );
      // The funnel can never report more redemptions than claims.
      assert.ok(after.entry.redeemedCount <= after.entry.claimedCount);

      // The released claim is in no redemption list, before or after.
      const history = await call(
        "GET",
        `/api/v1/tenderos/stores/${owner.storeId}/redemptions?limit=100&offset=0`,
        { token: owner.token },
      );
      assert.equal(history.status, 200, await history.clone().text());
      const entries = (
        (await history.json()) as { data: { entries: { claimId: string }[] } }
      ).data.entries;
      assert.equal(
        entries.some((entry) => entry.claimId === releasedClaim.id),
        false,
      );
      assert.equal(
        entries.some((entry) => entry.claimId === keptClaim.id),
        true,
      );
      assert.equal(
        after.data.recentRedemptions.some(
          (entry) => entry.claimId === releasedClaim.id,
        ),
        false,
      );
    },
  );

  await t.test(
    "claiming, re-issuing and redeeming still work as before (PRESERVE)",
    async () => {
      const coupon = await createCoupon(
        owner.token,
        owner.storeId,
        `Cupon preservacion ${runId}`,
      );
      const taken = await claimed(customer.token, coupon.id);
      assert.equal(taken.status, "claimed");
      assert.deepEqual(await storedCoupon(coupon.id), {
        claimedCount: 1,
        claimRows: 1,
      });

      const reissued = await reissue(customer.token, taken.id);
      assert.equal(reissued.status, 200, await reissued.clone().text());
      const fresh = ((await reissued.json()) as { data: CustomerClaim }).data;
      assert.ok(fresh.qrToken);
      assert.notEqual(fresh.qrToken, taken.qrToken);

      const dead = await redeem(owner.token, taken.qrToken as string);
      assert.equal(dead.status, 404, await dead.clone().text());
      assert.deepEqual(await dead.json(), {
        error: "No claim matches this QR code.",
      });

      const live = await redeem(owner.token, fresh.qrToken as string);
      assert.equal(live.status, 200, await live.clone().text());
      assert.equal((await storedClaim(taken.id))?.status, "redeemed");
      assert.deepEqual(await storedCoupon(coupon.id), {
        claimedCount: 1,
        claimRows: 1,
      });
    },
  );
});
