import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type {
  OtpRequestResponse,
  OtpVerifyResponse,
} from "@repo/api-contracts/auth";
import type { Store } from "@repo/api-contracts/products";
import type { Coupon, CouponProductRef } from "@repo/api-contracts";
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
  serviceName: "customer-registration-route-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "customer-registration-route-tests",
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

/**
 * C1 and C2: the two rules that let a customer app create its own account and
 * then claim with a name on it. Every case goes through the public HTTP surface
 * against live Postgres, because what is being asserted is the role the
 * database ends up storing and the status the response reports.
 */
test("customer registration carries the app role and requires a name", async (t) => {
  const harness = await startHarness();
  const cleanupDb = createDatabaseConnection(env);
  const runId = randomUUID();
  const emails: string[] = [];
  const userIds: string[] = [];
  let requestSequence = 0;

  const purge = async () => {
    if (emails.length > 0) {
      // Emails, not ids: a rejected registration must leave no row, and the
      // only handle on a row that should not exist is the address it would
      // have carried.
      await cleanupDb.pool.query(
        `delete from coupons where store_id in (
           select id from stores where owner_user_id in (
             select id from users where email_normalized = any($1::text[])))`,
        [emails],
      );
      await cleanupDb.pool.query(
        `delete from products where store_id in (
           select id from stores where owner_user_id in (
             select id from users where email_normalized = any($1::text[])))`,
        [emails],
      );
      await cleanupDb.pool.query(
        `delete from stores where owner_user_id in (
           select id from users where email_normalized = any($1::text[]))`,
        [emails],
      );
      await cleanupDb.pool.query(
        "delete from users where email_normalized = any($1::text[])",
        [emails],
      );
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
      [`customer-registration-${runId}-%`],
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
        "x-request-id": `customer-registration-${runId}-${requestSequence++}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const uniqueEmail = (label: string) => {
    const email = `customer-registration-${label}-${runId}@example.test`;
    emails.push(email);
    return email;
  };

  const requestCode = async (email: string) => {
    const requested = await call("POST", "/auth/otp/request", {
      body: { email },
    });
    assert.equal(requested.status, 200, await requested.clone().text());
    return ((await requested.json()) as OtpRequestResponse).challengeId;
  };

  /** One verification, with whatever body the case under test needs. */
  const verify = async (email: string, extra: object = {}) => {
    const challengeId = await requestCode(email);
    return call("POST", "/auth/otp/verify", {
      body: { email, challengeId, token: "123456", ...extra },
    });
  };

  const verified = async (email: string, extra: object = {}) => {
    const response = await verify(email, extra);
    assert.equal(response.status, 200, await response.clone().text());
    const session = (await response.json()) as OtpVerifyResponse;
    if (!userIds.includes(session.user.id)) userIds.push(session.user.id);
    return session;
  };

  const storedRole = async (email: string) => {
    const { rows } = await cleanupDb.pool.query<{ role: string }>(
      `select roles.name as role from users
         join roles on roles.id = users.role_id
        where users.email_normalized = $1`,
      [email],
    );
    return rows[0]?.role ?? null;
  };

  const countStoredUsers = async (email: string) => {
    const { rows } = await cleanupDb.pool.query<{ count: string }>(
      "select count(*)::text as count from users where email_normalized = $1",
      [email],
    );
    return Number(rows[0]?.count ?? 0);
  };

  const storedStatus = async (userId: string) => {
    const { rows } = await cleanupDb.pool.query<{ status: string }>(
      "select registration_status as status from users where id = $1",
      [userId],
    );
    return rows[0]?.status ?? null;
  };

  const me = async (token: string) => {
    const response = await call("GET", "/auth/me", { token });
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as OtpVerifyResponse).user;
  };

  const saveName = async (token: string, fullName: string) => {
    const response = await call("PATCH", "/auth/me", {
      token,
      body: { fullName },
    });
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as OtpVerifyResponse).user;
  };

  // A run that crashed before its teardown must not poison this one.
  await purge();

  const { rows: todayRows } = await cleanupDb.pool.query<{ today: string }>(
    "select (now() at time zone 'America/Bogota')::date::text as today",
  );
  const today = todayRows[0]?.today as string;

  await t.test("a client indication creates a client account", async () => {
    const email = uniqueEmail("client-app");
    const session = await verified(email, { registrationRole: "client" });

    assert.equal(session.isNewUser, true);
    assert.equal(session.user.role, "client");
    assert.equal(session.user.registrationStatus, "profile_required");
    assert.equal(session.user.fullName, "");
    assert.equal(await storedRole(email), "client");
  });

  await t.test(
    "a tendero indication and no indication both create a tendero",
    async () => {
      const asked = uniqueEmail("tendero-app");
      const askedSession = await verified(asked, {
        registrationRole: "tendero",
      });
      assert.equal(askedSession.user.role, "tendero");
      assert.equal(await storedRole(asked), "tendero");

      const silent = uniqueEmail("no-indication");
      const silentSession = await verified(silent);
      assert.equal(silentSession.user.role, "tendero");
      assert.equal(await storedRole(silent), "tendero");
    },
  );

  await t.test(
    "a role outside the two apps is rejected and creates nothing",
    async () => {
      for (const role of ["admin", "marca", "delivery", "superuser", ""]) {
        const email = uniqueEmail(`rejected-${role || "blank"}`);
        const response = await verify(email, { registrationRole: role });

        assert.equal(response.status, 400, `${role}: ${await response.clone().text()}`);
        const body = (await response.json()) as { error: string };
        assert.equal(body.error, "Invalid request payload.");
        // No privilege path: the rejection happens before any statement, so the
        // address that asked for it has no account at all.
        assert.equal(await countStoredUsers(email), 0, role);
      }
    },
  );

  await t.test(
    "an existing tendero keeps its role when the customer app asks for a client",
    async () => {
      const email = uniqueEmail("already-tendero");
      const first = await verified(email);
      assert.equal(first.user.role, "tendero");

      const second = await verified(email, { registrationRole: "client" });
      assert.equal(second.isNewUser, false);
      assert.equal(second.user.id, first.user.id);
      assert.equal(second.user.role, "tendero");
      assert.equal(await storedRole(email), "tendero");
    },
  );

  await t.test(
    "a customer on a tendero's email is refused by the customer routes",
    async () => {
      const email = uniqueEmail("shared-email");
      const session = await verified(email, { registrationRole: "tendero" });

      const response = await call("GET", "/api/v1/clientes/claims", {
        token: session.session.accessToken,
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: "You do not have access to this resource.",
      });
    },
  );

  await t.test(
    "a verification without an indication answers today's shape (PRESERVE)",
    async () => {
      const email = uniqueEmail("preserve-shape");
      const response = await verify(email);
      assert.equal(response.status, 200, await response.clone().text());
      const body = (await response.json()) as OtpVerifyResponse;
      userIds.push(body.user.id);

      assert.deepEqual(Object.keys(body).sort(), [
        "isNewUser",
        "session",
        "user",
      ]);
      assert.deepEqual(Object.keys(body.user).sort(), [
        "active",
        "email",
        "emailVerifiedAt",
        "fullName",
        "id",
        "registrationStatus",
        "role",
      ]);
      assert.deepEqual(Object.keys(body.session).sort(), [
        "accessToken",
        "expiresIn",
        "refreshToken",
      ]);
      assert.equal(body.isNewUser, true);
      assert.equal(body.user.email, email);
      assert.equal(body.user.fullName, "");
      assert.equal(body.user.role, "tendero");
      assert.equal(body.user.active, true);
      assert.equal(body.user.registrationStatus, "profile_required");
      assert.equal(body.session.expiresIn, 900);
      assert.match(
        body.user.emailVerifiedAt ?? "",
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    },
  );

  await t.test("a client completes registration by saving a name", async () => {
    const email = uniqueEmail("client-name");
    const session = await verified(email, { registrationRole: "client" });
    const token = session.session.accessToken;

    assert.equal((await me(token)).registrationStatus, "profile_required");

    const named = await saveName(token, "Camila Vega");
    assert.equal(named.fullName, "Camila Vega");
    assert.equal(named.registrationStatus, "completed");
    assert.equal(await storedStatus(session.user.id), "completed");

    // A second write never degrades the state it reached.
    const again = await saveName(token, "Camila Vega Ortiz");
    assert.equal(again.fullName, "Camila Vega Ortiz");
    assert.equal(again.registrationStatus, "completed");
  });

  await t.test(
    "the tendero status transitions are unchanged (PRESERVE)",
    async () => {
      const email = uniqueEmail("tendero-status");
      const session = await verified(email);
      const token = session.session.accessToken;
      assert.equal(session.user.registrationStatus, "profile_required");

      const named = await saveName(token, "Rosa Pardo");
      assert.equal(named.registrationStatus, "store_required");
      assert.equal(await storedStatus(session.user.id), "store_required");

      const completed = await call("POST", "/auth/registration/complete", {
        token,
        body: {
          fullName: "Rosa Pardo",
          store: { name: `Tienda estado ${runId}` },
        },
      });
      assert.equal(completed.status, 200, await completed.clone().text());
      assert.equal(await storedStatus(session.user.id), "completed");

      // And `completed` is never degraded by a later name change.
      const renamed = await saveName(token, "Rosa Pardo Díaz");
      assert.equal(renamed.registrationStatus, "completed");
    },
  );

  await t.test(
    "a nameless client cannot claim, and the stock is untouched",
    async () => {
      const tendero = await verified(uniqueEmail("coupon-owner"));
      const ownerToken = tendero.session.accessToken;
      const createdStore = await call("POST", "/api/v1/tenderos/stores", {
        token: ownerToken,
        body: { name: `Tienda cupon ${runId}` },
      });
      assert.equal(createdStore.status, 201, await createdStore.clone().text());
      const storeId = ((await createdStore.json()) as { data: Store }).data.id;

      const createdProduct = await call(
        "POST",
        `/api/v1/tenderos/stores/${storeId}/products`,
        { token: ownerToken, body: { name: "Arroz 1kg", price: 1.5, stock: 4 } },
      );
      assert.equal(createdProduct.status, 201);
      const product: CouponProductRef = {
        source: "store_private",
        productId: ((await createdProduct.json()) as { data: { id: string } })
          .data.id,
      };

      const createdCoupon = await call(
        "POST",
        `/api/v1/tenderos/stores/${storeId}/coupons`,
        {
          token: ownerToken,
          body: {
            type: "percentage",
            percentageValue: 20,
            title: `Cupon nombre ${runId}`,
            totalStock: 5,
            validFrom: shiftDays(today, -2),
            validTo: shiftDays(today, 5),
            paused: false,
            products: [product],
          },
        },
      );
      assert.equal(createdCoupon.status, 201, await createdCoupon.clone().text());
      const coupon = ((await createdCoupon.json()) as { data: Coupon }).data;

      const customer = await verified(uniqueEmail("nameless-claim"), {
        registrationRole: "client",
      });
      const customerToken = customer.session.accessToken;
      // C9: an adult birth date is what lets the customer reach the claim at
      // all; the name stays absent, which is the case under test.
      await cleanupDb.pool.query(
        "update users set birth_date = '1990-01-01' where id = $1",
        [customer.user.id],
      );

      const stored = async () => {
        const { rows } = await cleanupDb.pool.query<{
          claimed: number;
          claims: string;
        }>(
          `select c.claimed_count as claimed,
                  (select count(*)::text from coupon_claims where coupon_id = c.id) as claims
             from coupons c where c.id = $1`,
          [coupon.id],
        );
        return { claimed: rows[0]?.claimed ?? -1, claims: Number(rows[0]?.claims ?? -1) };
      };
      assert.deepEqual(await stored(), { claimed: 0, claims: 0 });

      const refused = await call(
        "POST",
        `/api/v1/clientes/coupons/${coupon.id}/claims`,
        { token: customerToken },
      );
      assert.equal(refused.status, 409, await refused.clone().text());
      assert.deepEqual(await refused.json(), {
        error: "Add your name before claiming a coupon.",
      });
      assert.deepEqual(await stored(), { claimed: 0, claims: 0 });

      // A whitespace-only name is the same absence: `PATCH /auth/me` accepts it
      // (its validation belongs to the tendero's frozen auth flow), so the
      // claim gate is what has to test for a renderable name.
      await saveName(customerToken, " ");
      const stillRefused = await call(
        "POST",
        `/api/v1/clientes/coupons/${coupon.id}/claims`,
        { token: customerToken },
      );
      assert.equal(stillRefused.status, 409, await stillRefused.clone().text());
      assert.deepEqual(await stored(), { claimed: 0, claims: 0 });

      await saveName(customerToken, "Camila Vega");
      const accepted = await call(
        "POST",
        `/api/v1/clientes/coupons/${coupon.id}/claims`,
        { token: customerToken },
      );
      assert.equal(accepted.status, 201, await accepted.clone().text());
      assert.deepEqual(await stored(), { claimed: 1, claims: 1 });
    },
  );
});
