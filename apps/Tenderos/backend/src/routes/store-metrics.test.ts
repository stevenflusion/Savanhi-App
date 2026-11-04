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
  CouponRedemptionHistoryEntry,
  CouponRedemptionHistoryPage,
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
  serviceName: "store-metrics-route-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "store-metrics-route-tests",
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

const metricsPath = (storeId: string) =>
  `/api/v1/tenderos/stores/${storeId}/metrics`;
const historyPath = (storeId: string) =>
  `/api/v1/tenderos/stores/${storeId}/redemptions`;

/** The owner check every store-scoped route already answers with (T2, T4). */
const NOT_OWNED_MESSAGE = "Store does not belong to this tendero.";

test("the tendero reads the metrics of a store they own", async (t) => {
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
        "delete from store_follows where customer_user_id = $1",
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
      [`store-metrics-${runId}-%`],
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
        "x-request-id": `store-metrics-${runId}-${requestSequence++}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Signs a user in through the real OTP flow. */
  const signIn = async (label: string) => {
    const email = `store-metrics-${label}-${runId}@example.test`;
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
    return {
      token: session.session.accessToken,
      userId: session.user.id,
      email,
    };
  };

  /**
   * The tenderos backend registers every user as a `tendero`, and the customer
   * app that will register a `client` does not exist yet (S2, L10). The role is
   * read from the database on every request, so flipping the row is the whole
   * fixture — the same path the T4, T5 and T6 suites already use.
   */
  const signInAsCustomer = async (
    label: string,
    fullName = `Cliente ${label}`,
  ) => {
    const customer = await signIn(label);
    await cleanupDb.pool.query(
      "update users set role_id = (select id from roles where name = 'client') where id = $1",
      [customer.userId],
    );
    // Every customer is named here because C2 gates the claim on it; the one
    // case about a customer with no name blanks the column after the claim.
    const named = await call("PATCH", "/auth/me", {
      token: customer.token,
      body: { fullName },
    });
    assert.equal(named.status, 200, await named.clone().text());
    return customer;
  };

  /**
   * Empties a customer's name AFTER their claim exists. C2 makes a nameless
   * claim impossible to create through the API, but the row is still real:
   * every claim made before C2 existed belongs to an OTP-registered customer
   * whose `full_name` is `''`, and the history has to render that absence.
   * There is no route that empties a name, so the fixture writes the column.
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

  /** Claims a coupon and keeps the plaintext token the tendero will scan. */
  const claim = async (customerToken: string, couponId: string) => {
    const response = await call(
      "POST",
      `/api/v1/clientes/coupons/${couponId}/claims`,
      { token: customerToken },
    );
    assert.equal(response.status, 201, await response.clone().text());
    const data = ((await response.json()) as { data: CustomerClaim }).data;
    return { id: data.id, qrToken: data.qrToken as string };
  };

  /** Redeems through the real scanner route (T6), never by writing the row. */
  const redeem = async (tenderoToken: string, qrToken: string) => {
    const response = await call("POST", "/api/v1/tenderos/coupon-redemptions", {
      token: tenderoToken,
      body: { qrToken },
    });
    assert.equal(response.status, 200, await response.clone().text());
  };

  const follow = async (customerToken: string, storeId: string) => {
    const response = await call(
      "PUT",
      `/api/v1/clientes/stores/${storeId}/follow`,
      { token: customerToken },
    );
    assert.equal(response.status, 200, await response.clone().text());
  };

  const unfollow = async (customerToken: string, storeId: string) => {
    const response = await call(
      "DELETE",
      `/api/v1/clientes/stores/${storeId}/follow`,
      { token: customerToken },
    );
    assert.equal(response.status, 200, await response.clone().text());
  };

  /**
   * The raw body travels beside the parsed one, so the S11 assertions can be
   * made against the bytes that actually went over the wire — a missing field
   * is invisible to a typed read.
   */
  const readJson = async <T>(response: Response) => {
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return { data: (JSON.parse(text) as { data: T }).data, text };
  };

  const readMetrics = (token: string, storeId: string) =>
    call("GET", metricsPath(storeId), { token }).then((response) =>
      readJson<StoreMetrics>(response),
    );

  const readHistory = (token: string, storeId: string, query = "") =>
    call("GET", `${historyPath(storeId)}${query}`, { token }).then(
      (response) => readJson<CouponRedemptionHistoryPage>(response),
    );

  const couponMetricsOf = (metrics: StoreMetrics, couponId: string) => {
    const found = metrics.coupons.find(
      (entry) => entry.couponId === couponId,
    );
    assert.ok(found, `no metrics for coupon ${couponId}`);
    return found;
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
  const CURRENT = {
    validFrom: shiftDays(today, -5),
    validTo: shiftDays(today, 5),
  };
  const EXPIRED = {
    validFrom: shiftDays(today, -10),
    validTo: shiftDays(today, -1),
  };

  const owner = await createTendero("owner");
  const intruder = await createTendero("intruder");
  const fresh = await createTendero("fresh");

  const ownerProduct = await createPrivateProduct(
    owner.token,
    owner.storeId,
    "Arroz 1kg",
  );
  const intruderProduct = await createPrivateProduct(
    intruder.token,
    intruder.storeId,
    "Pan intruso",
  );

  const ana = await signInAsCustomer("ana", "Ana María Pérez");
  const bruno = await signInAsCustomer("bruno", "Bruno Gómez");
  const carla = await signInAsCustomer("carla", "Carla Ruiz");
  const nameless = await signInAsCustomer("nameless");

  await t.test("an anonymous caller cannot reach a metrics route", async () => {
    for (const path of [metricsPath(owner.storeId), historyPath(owner.storeId)]) {
      const response = await call("GET", path);
      assert.equal(response.status, 401, path);
    }
  });

  await t.test("a customer cannot read a store's metrics", async () => {
    for (const path of [metricsPath(owner.storeId), historyPath(owner.storeId)]) {
      const response = await call("GET", path, { token: ana.token });
      assert.equal(response.status, 403, path);
    }
  });

  await t.test(
    "a tendero cannot read another tendero's metrics",
    async () => {
      for (const path of [
        metricsPath(owner.storeId),
        historyPath(owner.storeId),
      ]) {
        const response = await call("GET", path, { token: intruder.token });
        assert.equal(response.status, 403, path);
        assert.equal(
          ((await response.json()) as { error: string }).error,
          NOT_OWNED_MESSAGE,
          path,
        );
      }
    },
  );

  await t.test("a store that exists nowhere is not this tendero's", async () => {
    // The same answer as another tendero's store, which is what
    // `requireOwnedStore` has meant since T2: the scope is "stores I own", and
    // nothing outside it is distinguishable from nothing at all.
    for (const path of [metricsPath(randomUUID()), historyPath(randomUUID())]) {
      const response = await call("GET", path, { token: owner.token });
      assert.equal(response.status, 403, path);
    }
  });

  await t.test("a store id that is not a uuid is rejected", async () => {
    for (const path of [metricsPath("not-a-uuid"), historyPath("not-a-uuid")]) {
      const response = await call("GET", path, { token: owner.token });
      assert.equal(response.status, 400, path);
    }
  });

  await t.test(
    "an empty store reports zeros and an empty history",
    async () => {
      const { data } = await readMetrics(fresh.token, fresh.storeId);
      assert.deepEqual(Object.keys(data).sort(), [
        "coupons",
        "followersCount",
        "recentRedemptions",
        "storeId",
        "totals",
      ]);
      assert.equal(data.storeId, fresh.storeId);
      assert.equal(data.followersCount, 0);
      assert.deepEqual(data.coupons, []);
      assert.deepEqual(data.recentRedemptions, []);
      assert.deepEqual(data.totals, {
        couponCount: 0,
        claimedCount: 0,
        redeemedCount: 0,
        remainingStock: 0,
      });

      const history = await readHistory(fresh.token, fresh.storeId);
      assert.deepEqual(history.data.entries, []);
      assert.equal(history.data.nextOffset, null);
    },
  );

  /**
   * The per-coupon funnel (S9). Three coupons of the owning store, each with a
   * different claim/redemption mix, plus one coupon of another store that must
   * never be counted into them.
   */
  const mixed = await createCoupon(owner.token, owner.storeId, ownerProduct, {
    ...CURRENT,
    title: `Cupon mixto ${runId}`,
    totalStock: 10,
  });
  const expired = await createCoupon(owner.token, owner.storeId, ownerProduct, {
    ...CURRENT,
    title: `Cupon vencido ${runId}`,
    totalStock: 4,
  });
  const untouched = await createCoupon(
    owner.token,
    owner.storeId,
    ownerProduct,
    { ...CURRENT, title: `Cupon sin reclamos ${runId}`, totalStock: 7 },
  );
  const foreign = await createCoupon(
    intruder.token,
    intruder.storeId,
    intruderProduct,
    { ...CURRENT, title: `Cupon ajeno ${runId}`, totalStock: 9 },
  );

  const mixedByAna = await claim(ana.token, mixed.id);
  await claim(bruno.token, mixed.id);
  await redeem(owner.token, mixedByAna.qrToken);

  // Claimed while the coupon was still valid, then left unredeemed past its
  // validity end date — which is an expired claim (S6) and still a CLAIM.
  await claim(carla.token, expired.id);
  await cleanupDb.pool.query(
    "update coupons set valid_from = $2, valid_to = $3 where id = $1",
    [expired.id, EXPIRED.validFrom, EXPIRED.validTo],
  );

  // Another store's claim and redemption, to prove the scoping.
  const foreignByAna = await claim(ana.token, foreign.id);
  await redeem(intruder.token, foreignByAna.qrToken);

  await follow(ana.token, owner.storeId);
  await follow(bruno.token, owner.storeId);
  await follow(carla.token, intruder.storeId);

  await t.test(
    "per-coupon claimed and redeemed counts follow the claims",
    async () => {
      const { data } = await readMetrics(owner.token, owner.storeId);

      assert.deepEqual(Object.keys(couponMetricsOf(data, mixed.id)).sort(), [
        "claimedCount",
        "couponId",
        "redeemedCount",
        "remainingStock",
        "title",
        "totalStock",
        "type",
      ]);

      const mixedMetrics = couponMetricsOf(data, mixed.id);
      assert.equal(mixedMetrics.title, `Cupon mixto ${runId}`);
      assert.equal(mixedMetrics.type, "percentage");
      assert.equal(mixedMetrics.totalStock, 10);
      assert.equal(mixedMetrics.claimedCount, 2);
      assert.equal(mixedMetrics.redeemedCount, 1);
      assert.equal(mixedMetrics.remainingStock, 8);

      const untouchedMetrics = couponMetricsOf(data, untouched.id);
      assert.equal(untouchedMetrics.claimedCount, 0);
      assert.equal(untouchedMetrics.redeemedCount, 0);
      assert.equal(untouchedMetrics.remainingStock, 7);

      // The counter that gates claiming and the claim rows tell one story.
      const { rows } = await cleanupDb.pool.query<{
        claimed_count: number;
        claims: string;
      }>(
        `select c.claimed_count,
                (select count(*)::text from coupon_claims where coupon_id = c.id) as claims
           from coupons c where c.id = $1`,
        [mixed.id],
      );
      assert.equal(rows[0]?.claimed_count, 2);
      assert.equal(Number(rows[0]?.claims), 2);
    },
  );

  await t.test(
    "an expired unredeemed claim counts as claimed and never as redeemed",
    async () => {
      const { data } = await readMetrics(owner.token, owner.storeId);
      const metrics = couponMetricsOf(data, expired.id);

      assert.equal(metrics.claimedCount, 1);
      assert.equal(metrics.redeemedCount, 0);
      assert.equal(metrics.remainingStock, 3);

      // And it is not in the redemption history either.
      const history = await readHistory(owner.token, owner.storeId);
      assert.equal(
        history.data.entries.some(
          (entry) => entry.couponTitle === `Cupon vencido ${runId}`,
        ),
        false,
      );
    },
  );

  await t.test("another store's coupons and claims never appear", async () => {
    const { data, text } = await readMetrics(owner.token, owner.storeId);

    assert.deepEqual(
      data.coupons.map((entry) => entry.couponId).sort(),
      [mixed.id, expired.id, untouched.id].sort(),
    );
    assert.equal(text.includes(`Cupon ajeno ${runId}`), false);
    assert.equal(text.includes(foreign.id), false);

    // The totals are the sum of this store's coupons and nothing else.
    assert.deepEqual(data.totals, {
      couponCount: 3,
      claimedCount: 3,
      redeemedCount: 1,
      remainingStock: 8 + 3 + 7,
    });

    // The other tendero reads their own store and sees only their own coupon.
    const theirs = await readMetrics(intruder.token, intruder.storeId);
    assert.deepEqual(
      theirs.data.coupons.map((entry) => entry.couponId),
      [foreign.id],
    );
    assert.equal(theirs.data.totals.redeemedCount, 1);
    assert.equal(theirs.text.includes(`Cupon mixto ${runId}`), false);
  });

  await t.test("the follower count follows follow and unfollow", async () => {
    assert.equal(
      (await readMetrics(owner.token, owner.storeId)).data.followersCount,
      2,
    );

    await unfollow(bruno.token, owner.storeId);
    assert.equal(
      (await readMetrics(owner.token, owner.storeId)).data.followersCount,
      1,
    );

    // Follow is idempotent (S7), so a repeat is still one follower.
    await follow(bruno.token, owner.storeId);
    await follow(bruno.token, owner.storeId);
    assert.equal(
      (await readMetrics(owner.token, owner.storeId)).data.followersCount,
      2,
    );

    // A customer following ANOTHER store is not a follower of this one.
    assert.equal(
      (await readMetrics(intruder.token, intruder.storeId)).data
        .followersCount,
      1,
    );
  });

  /**
   * The redemption history. Four redemptions on one coupon, then the stored
   * display date is spread over four days so the newest-first ordering is
   * assertable. The date is the only thing the schema keeps (S11), so the
   * fixture writes the column a redemption on that day would have written.
   */
  const history = await createCoupon(
    owner.token,
    owner.storeId,
    ownerProduct,
    { ...CURRENT, title: `Cupon historial ${runId}`, totalStock: 10 },
  );
  const redemptions: { claimId: string; name: string | null; on: string }[] = [];
  for (const [index, customer] of [ana, bruno, carla, nameless].entries()) {
    const claimed = await claim(customer.token, history.id);
    await redeem(owner.token, claimed.qrToken);
    const on = shiftDays(today, -index);
    await cleanupDb.pool.query(
      "update coupon_claims set redeemed_on = $2 where id = $1",
      [claimed.id, on],
    );
    redemptions.push({
      claimId: claimed.id,
      name: ["Ana", "Bruno", "Carla", null][index] ?? null,
      on,
    });
  }
  // Every claim above exists now, so the fourth customer can lose its name:
  // the history entry it produced is the one that has to read `null` (C2).
  await blankName(nameless.userId);

  await t.test(
    "the history is newest first and shows title, first name and date",
    async () => {
      const { data, text } = await readHistory(owner.token, owner.storeId);

      assert.deepEqual(Object.keys(data).sort(), [
        "entries",
        "limit",
        "offset",
        "nextOffset",
      ].sort());

      const ours = data.entries.filter(
        (entry) => entry.couponTitle === `Cupon historial ${runId}`,
      );
      assert.equal(ours.length, 4);
      assert.deepEqual(
        ours.map((entry) => [entry.customerName, entry.redeemedOn]),
        redemptions.map((entry) => [entry.name, entry.on]),
      );

      assert.deepEqual(Object.keys(ours[0] as CouponRedemptionHistoryEntry).sort(), [
        "claimId",
        "couponTitle",
        "customerName",
        "redeemedOn",
      ]);

      // S11 — a date and no clock time anywhere, and the surname and the email
      // never travel (the full name stays in the data layer).
      for (const entry of ours) {
        assert.match(entry.redeemedOn, /^\d{4}-\d{2}-\d{2}$/);
      }
      assert.equal(/\d{2}:\d{2}/.test(text), false, text);
      for (const customer of [ana, bruno, carla, nameless]) {
        assert.equal(text.includes(customer.email), false);
      }
      assert.equal(text.includes("Pérez"), false);
      assert.equal(text.includes("Gómez"), false);
    },
  );

  await t.test(
    "the ordering is stable when several redemptions share a date",
    async () => {
      // Every redemption of this coupon on one day: the date cannot order them,
      // so the tiebreaker has to, and it has to answer the same way twice.
      const sameDay = shiftDays(today, -20);
      await cleanupDb.pool.query(
        `update coupon_claims set redeemed_on = $2
           where coupon_id = $1 and status = 'redeemed'`,
        [history.id, sameDay],
      );

      const first = await readHistory(owner.token, owner.storeId, "?limit=50");
      const second = await readHistory(owner.token, owner.storeId, "?limit=50");
      assert.deepEqual(
        first.data.entries.map((entry) => entry.claimId),
        second.data.entries.map((entry) => entry.claimId),
      );

      // Paging through the same list yields each entry exactly once.
      const paged: string[] = [];
      for (let offset = 0; offset < first.data.entries.length; offset += 2) {
        const page = await readHistory(
          owner.token,
          owner.storeId,
          `?limit=2&offset=${offset}`,
        );
        paged.push(...page.data.entries.map((entry) => entry.claimId));
      }
      assert.deepEqual(
        paged,
        first.data.entries.map((entry) => entry.claimId),
      );
    },
  );

  await t.test("the history is paginated with a bounded limit", async () => {
    const all = await readHistory(owner.token, owner.storeId, "?limit=50");
    const total = all.data.entries.length;
    assert.ok(total >= 5, `expected several redemptions, got ${total}`);

    const defaulted = await readHistory(owner.token, owner.storeId);
    assert.equal(defaulted.data.limit, 20);
    assert.equal(defaulted.data.offset, 0);

    const firstPage = await readHistory(owner.token, owner.storeId, "?limit=2");
    assert.equal(firstPage.data.entries.length, 2);
    assert.equal(firstPage.data.limit, 2);
    assert.equal(firstPage.data.offset, 0);
    assert.equal(firstPage.data.nextOffset, 2);

    const secondPage = await readHistory(
      owner.token,
      owner.storeId,
      "?limit=2&offset=2",
    );
    assert.equal(secondPage.data.offset, 2);
    assert.deepEqual(
      secondPage.data.entries.map((entry) => entry.claimId),
      all.data.entries.slice(2, 4).map((entry) => entry.claimId),
    );

    // The last page says so, instead of making the client ask for an empty one.
    const lastPage = await readHistory(
      owner.token,
      owner.storeId,
      `?limit=${total}`,
    );
    assert.equal(lastPage.data.entries.length, total);
    assert.equal(lastPage.data.nextOffset, null);

    const beyond = await readHistory(
      owner.token,
      owner.storeId,
      `?limit=5&offset=${total}`,
    );
    assert.deepEqual(beyond.data.entries, []);
    assert.equal(beyond.data.nextOffset, null);
  });

  await t.test("an out-of-range page is rejected", async () => {
    for (const query of [
      "?limit=101",
      "?limit=0",
      "?limit=-1",
      "?limit=abc",
      "?limit=1.5",
      "?offset=-1",
      "?offset=abc",
    ]) {
      const response = await call(
        "GET",
        `${historyPath(owner.storeId)}${query}`,
        { token: owner.token },
      );
      assert.equal(response.status, 400, query);
    }

    // The maximum itself is accepted; only past it is a rejection.
    const atMax = await call(
      "GET",
      `${historyPath(owner.storeId)}?limit=100`,
      { token: owner.token },
    );
    assert.equal(atMax.status, 200, await atMax.clone().text());
  });

  await t.test(
    "the summary carries the newest redemptions for the home tab",
    async () => {
      const { data } = await readMetrics(owner.token, owner.storeId);
      const page = await readHistory(owner.token, owner.storeId, "?limit=5");

      // The same list, from the same read — the home tab needs no second call.
      assert.equal(data.recentRedemptions.length, 5);
      assert.deepEqual(
        data.recentRedemptions.map((entry) => entry.claimId),
        page.data.entries.map((entry) => entry.claimId),
      );

      // The totals are the sum of the per-coupon rows in the same response, so
      // the two can never disagree.
      assert.deepEqual(data.totals, {
        couponCount: data.coupons.length,
        claimedCount: data.coupons.reduce(
          (sum, entry) => sum + entry.claimedCount,
          0,
        ),
        redeemedCount: data.coupons.reduce(
          (sum, entry) => sum + entry.redeemedCount,
          0,
        ),
        remainingStock: data.coupons.reduce(
          (sum, entry) => sum + entry.remainingStock,
          0,
        ),
      });
    },
  );

  await t.test(
    "the coupon, redemption and follow routes still answer as before",
    async () => {
      const status = await call("GET", "/api/v1/tenderos/status");
      assert.equal(status.status, 200);

      const listed = await call(
        "GET",
        `/api/v1/tenderos/stores/${owner.storeId}/coupons`,
        { token: owner.token },
      );
      assert.equal(listed.status, 200);
      const coupons = ((await listed.json()) as { data: Coupon[] }).data;
      const sample = coupons[0];
      assert.ok(sample);
      assert.deepEqual(Object.keys(sample).sort(), [
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
      ].sort());

      // The differential check on the ONE thing this task adds to a shared
      // surface: a query window. The new schema is strict and rejects a limit
      // past the maximum, so the sibling store-scoped routes are called with
      // exactly that input to prove it did not leak into them — they ignore
      // unknown query parameters now as they did before.
      for (const sibling of ["coupons", "products", "product-categories"]) {
        const response = await call(
          "GET",
          `/api/v1/tenderos/stores/${owner.storeId}/${sibling}?limit=101&offset=-1`,
          { token: owner.token },
        );
        assert.equal(response.status, 200, sibling);
      }

      // The customer side is untouched: a claim still reserves stock and the
      // scanner still redeems it.
      const extra = await createCoupon(
        owner.token,
        owner.storeId,
        ownerProduct,
        { ...CURRENT, title: `Cupon de preservacion ${runId}` },
      );
      // A named customer: the fixture above left `nameless` without one, and
      // C2 would refuse its claim for that reason instead of proving that the
      // customer side still reserves and redeems.
      const taken = await claim(ana.token, extra.id);
      await redeem(owner.token, taken.qrToken);
    },
  );
});
