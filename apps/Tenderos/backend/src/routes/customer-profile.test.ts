import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type {
  CustomerProfile,
  OtpRequestResponse,
  OtpVerifyResponse,
} from "@repo/api-contracts/auth";
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
  serviceName: "customer-profile-route-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "customer-profile-route-tests",
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

type StoredProfile = {
  full_name: string;
  birth_date: string | null;
  registration_status: string;
  role: string;
};

/**
 * C8 and C9: a customer is eligible to use the customer API only with a stored
 * birth date that makes them at least 18 on the `America/Bogota` calendar day.
 * Every case goes through the public HTTP surface against live Postgres,
 * because what is asserted is what the database ends up storing and what the
 * response says — including that a rejected command changes nothing.
 */
test("customer birth date and 18+ eligibility", async (t) => {
  const harness = await startHarness();
  const cleanupDb = createDatabaseConnection(env);
  const runId = randomUUID();
  const emails: string[] = [];
  let requestSequence = 0;

  const purge = async () => {
    if (emails.length > 0) {
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
      [`customer-profile-${runId}-%`],
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
    { body, token }: { body?: unknown; token?: string } = {},
  ) =>
    fetch(`${harness.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-request-id": `customer-profile-${runId}-${requestSequence++}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const uniqueEmail = (label: string) => {
    const email = `customer-profile-${label}-${runId}@example.test`;
    emails.push(email);
    return email;
  };

  const verified = async (email: string, extra: object = {}) => {
    const requested = await call("POST", "/auth/otp/request", {
      body: { email },
    });
    assert.equal(requested.status, 200, await requested.clone().text());
    const { challengeId } = (await requested.json()) as OtpRequestResponse;
    const response = await call("POST", "/auth/otp/verify", {
      body: { email, challengeId, token: "123456", ...extra },
    });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as OtpVerifyResponse;
  };

  const newCustomer = (label: string) =>
    verified(uniqueEmail(label), { registrationRole: "client" });

  const stored = async (userId: string): Promise<StoredProfile> => {
    const { rows } = await cleanupDb.pool.query<StoredProfile>(
      `select users.full_name, users.birth_date::text as birth_date,
              users.registration_status, roles.name as role
         from users join roles on roles.id = users.role_id
        where users.id = $1`,
      [userId],
    );
    return rows[0] as StoredProfile;
  };

  const sql = async (text: string, params: unknown[] = []) =>
    (await cleanupDb.pool.query<{ value: string }>(text, params)).rows[0]
      ?.value as string;

  // Both boundaries come from the database's own Bogota calendar, so the case
  // cannot disagree with the server about which day it is.
  const eighteenToday = await sql(
    `select ((now() at time zone 'America/Bogota')::date - interval '18 years')::date::text as value`,
  );
  const eighteenTomorrow = await sql(
    `select ((now() at time zone 'America/Bogota')::date - interval '18 years' + interval '1 day')::date::text as value`,
  );
  const adultBirthDate = "1990-06-15";

  const putProfile = (token: string, body: unknown) =>
    call("PUT", "/api/v1/clientes/profile", { token, body });

  const readProfile = async (token: string) => {
    const response = await call("GET", "/api/v1/clientes/profile", { token });
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { data: CustomerProfile }).data;
  };

  await purge();

  await t.test(
    "a new customer reads an incomplete profile and cannot use the customer API",
    async () => {
      const customer = await newCustomer("new");
      const token = customer.session.accessToken;

      assert.deepEqual(await readProfile(token), {
        fullName: "",
        birthDate: null,
        eligibility: "birth_date_required",
      });

      const customerRoutes: [string, string][] = [
        ["GET", "/api/v1/clientes/stores/nearby?lat=4.711&lng=-74.0721"],
        ["GET", "/api/v1/clientes/stores/followed"],
        ["PUT", `/api/v1/clientes/stores/${randomUUID()}/follow`],
        ["DELETE", `/api/v1/clientes/stores/${randomUUID()}/follow`],
        ["GET", "/api/v1/clientes/coupons/feed"],
        ["POST", `/api/v1/clientes/coupons/${randomUUID()}/claims`],
        ["GET", "/api/v1/clientes/claims"],
        ["POST", `/api/v1/clientes/claims/${randomUUID()}/release`],
        ["POST", `/api/v1/clientes/claims/${randomUUID()}/qr`],
      ];
      for (const [method, path] of customerRoutes) {
        const response = await call(method, path, { token });
        assert.equal(response.status, 403, `${method} ${path}`);
        assert.deepEqual(await response.json(), {
          error: "Complete your profile to use Savanhi.",
          details: { eligibility: "birth_date_required", minimumAge: 18 },
        });
      }
    },
  );

  await t.test(
    "an existing named customer without a birth date is gated too (no grandfathering)",
    async () => {
      const customer = await newCustomer("existing");
      const token = customer.session.accessToken;
      const named = await call("PATCH", "/auth/me", {
        token,
        body: { fullName: "Camila Vega" },
      });
      assert.equal(named.status, 200);
      assert.equal(
        ((await named.json()) as OtpVerifyResponse).user.registrationStatus,
        "completed",
      );

      const feed = await call("GET", "/api/v1/clientes/coupons/feed", {
        token,
      });
      assert.equal(feed.status, 403);
      assert.equal(
        ((await feed.json()) as { details: { eligibility: string } }).details
          .eligibility,
        "birth_date_required",
      );
      assert.equal((await readProfile(token)).fullName, "Camila Vega");
    },
  );

  await t.test("a valid profile unlocks the customer API", async () => {
    const customer = await newCustomer("valid");
    const token = customer.session.accessToken;

    const saved = await putProfile(token, {
      fullName: "  Camila Vega  ",
      birthDate: adultBirthDate,
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.deepEqual(await saved.json(), {
      data: {
        fullName: "Camila Vega",
        birthDate: adultBirthDate,
        eligibility: "eligible",
      },
    });
    assert.deepEqual(await stored(customer.user.id), {
      full_name: "Camila Vega",
      birth_date: adultBirthDate,
      registration_status: "completed",
      role: "client",
    });
    assert.deepEqual(await readProfile(token), {
      fullName: "Camila Vega",
      birthDate: adultBirthDate,
      eligibility: "eligible",
    });

    const feed = await call("GET", "/api/v1/clientes/coupons/feed", { token });
    assert.equal(feed.status, 200, await feed.clone().text());
    const claims = await call("GET", "/api/v1/clientes/claims", { token });
    assert.equal(claims.status, 200, await claims.clone().text());
  });

  await t.test(
    "the 18th birthday counts, the day before it does not",
    async () => {
      const adult = await newCustomer("birthday-today");
      const today = await putProfile(adult.session.accessToken, {
        fullName: "Ana Cruz",
        birthDate: eighteenToday,
      });
      assert.equal(today.status, 200, await today.clone().text());
      assert.equal((await stored(adult.user.id)).birth_date, eighteenToday);

      const minor = await newCustomer("birthday-tomorrow");
      const tomorrow = await putProfile(minor.session.accessToken, {
        fullName: "Ana Cruz",
        birthDate: eighteenTomorrow,
      });
      assert.equal(tomorrow.status, 422, await tomorrow.clone().text());
      assert.deepEqual(await tomorrow.json(), {
        error: "You must be at least 18 years old to use Savanhi.",
        details: { eligibility: "underage", minimumAge: 18 },
      });
      assert.deepEqual(await stored(minor.user.id), {
        full_name: "",
        birth_date: null,
        registration_status: "profile_required",
        role: "client",
      });
      const feed = await call("GET", "/api/v1/clientes/coupons/feed", {
        token: minor.session.accessToken,
      });
      assert.equal(feed.status, 403);
    },
  );

  await t.test(
    "an underage or invalid submission leaves an eligible profile untouched",
    async () => {
      const customer = await newCustomer("rejects");
      const token = customer.session.accessToken;
      const first = await putProfile(token, {
        fullName: "Camila Vega",
        birthDate: adultBirthDate,
      });
      assert.equal(first.status, 200);
      const before = await stored(customer.user.id);

      const underage = await putProfile(token, {
        fullName: "Otro Nombre",
        birthDate: eighteenTomorrow,
      });
      assert.equal(underage.status, 422);

      const future = await putProfile(token, {
        fullName: "Otro Nombre",
        birthDate: "2999-01-01",
      });
      assert.equal(future.status, 422);

      const invalidBodies: unknown[] = [
        {},
        { fullName: "Otro Nombre" },
        { birthDate: adultBirthDate },
        { fullName: "Otro Nombre", birthDate: null },
        { fullName: "Otro Nombre", birthDate: "" },
        { fullName: "Otro Nombre", birthDate: "04/11/2002" },
        { fullName: "Otro Nombre", birthDate: "2002-4-11" },
        { fullName: "Otro Nombre", birthDate: "2002-02-30" },
        { fullName: "Otro Nombre", birthDate: "2023-02-29" },
        { fullName: "Otro Nombre", birthDate: "0000-01-01" },
        { fullName: "Otro Nombre", birthDate: "2002-11-04T10:00:00Z" },
        { fullName: "Otro Nombre", birthDate: 20021104 },
        { fullName: "", birthDate: adultBirthDate },
        { fullName: "   ", birthDate: adultBirthDate },
        { fullName: 42, birthDate: adultBirthDate },
      ];
      for (const body of invalidBodies) {
        const response = await putProfile(token, body);
        assert.equal(response.status, 400, JSON.stringify(body));
        const payload = (await response.json()) as { error: string };
        assert.equal(payload.error, "Invalid request payload.");
      }

      assert.deepEqual(await stored(customer.user.id), before);
    },
  );

  await t.test("a real birth date before 1900 is accepted", async () => {
    const customer = await newCustomer("pre-1900");
    const saved = await putProfile(customer.session.accessToken, {
      fullName: "Elena Rios",
      birthDate: "1899-12-31",
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal((await stored(customer.user.id)).birth_date, "1899-12-31");
  });

  await t.test(
    "a leap-day birth date is a real date only in leap years",
    async () => {
      const customer = await newCustomer("leap");
      const token = customer.session.accessToken;
      const common = await putProfile(token, {
        fullName: "Leo Salas",
        birthDate: "2001-02-29",
      });
      assert.equal(common.status, 400);
      assert.equal((await stored(customer.user.id)).birth_date, null);

      const leap = await putProfile(token, {
        fullName: "Leo Salas",
        birthDate: "2000-02-29",
      });
      assert.equal(leap.status, 200, await leap.clone().text());
      assert.equal((await stored(customer.user.id)).birth_date, "2000-02-29");
    },
  );

  await t.test(
    "a stored birth date that is underage blocks the customer API",
    async () => {
      const customer = await newCustomer("stored-underage");
      const token = customer.session.accessToken;
      await cleanupDb.pool.query(
        "update users set birth_date = $2::date, full_name = 'Menor' where id = $1",
        [customer.user.id, eighteenTomorrow],
      );
      assert.equal((await readProfile(token)).eligibility, "underage");
      const feed = await call("GET", "/api/v1/clientes/coupons/feed", {
        token,
      });
      assert.equal(feed.status, 403);
      assert.deepEqual(await feed.json(), {
        error: "You must be at least 18 years old to use Savanhi.",
        details: { eligibility: "underage", minimumAge: 18 },
      });

      // The way out is a corrected date, never a gate on the profile itself.
      const corrected = await putProfile(token, {
        fullName: "Menor",
        birthDate: adultBirthDate,
      });
      assert.equal(corrected.status, 200);
      const feedAgain = await call("GET", "/api/v1/clientes/coupons/feed", {
        token,
      });
      assert.equal(feedAgain.status, 200);
    },
  );

  await t.test(
    "an incomplete customer can read the profile and log out",
    async () => {
      const customer = await newCustomer("logout");
      const token = customer.session.accessToken;
      assert.equal(
        (await readProfile(token)).eligibility,
        "birth_date_required",
      );
      const me = await call("GET", "/auth/me", { token });
      assert.equal(me.status, 200);
      const out = await call("POST", "/auth/logout", { token });
      assert.equal(out.status, 200);
      assert.deepEqual(await out.json(), { ok: true });
      const after = await call("GET", "/api/v1/clientes/profile", { token });
      assert.equal(after.status, 401);
    },
  );

  await t.test(
    "only an authenticated client can use the profile route",
    async () => {
      const anonymousRead = await call("GET", "/api/v1/clientes/profile");
      assert.equal(anonymousRead.status, 401);
      const anonymousWrite = await call("PUT", "/api/v1/clientes/profile", {
        body: { fullName: "Nadie", birthDate: adultBirthDate },
      });
      assert.equal(anonymousWrite.status, 401);

      const tendero = await verified(uniqueEmail("tendero"));
      const token = tendero.session.accessToken;
      const read = await call("GET", "/api/v1/clientes/profile", { token });
      assert.equal(read.status, 403);
      assert.deepEqual(await read.json(), {
        error: "You do not have access to this resource.",
      });
      const write = await putProfile(token, {
        fullName: "Rosa Pardo",
        birthDate: adultBirthDate,
      });
      assert.equal(write.status, 403);
      assert.deepEqual(await stored(tendero.user.id), {
        full_name: "",
        birth_date: null,
        registration_status: "profile_required",
        role: "tendero",
      });
    },
  );

  await t.test("a profile write can never change the stored role", async () => {
    const customer = await newCustomer("role");
    const token = customer.session.accessToken;
    const saved = await putProfile(token, {
      fullName: "Camila Vega",
      birthDate: adultBirthDate,
      role: "tendero",
      registrationRole: "tendero",
      registrationStatus: "store_required",
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    const row = await stored(customer.user.id);
    assert.equal(row.role, "client");
    assert.equal(row.registration_status, "completed");
  });

  await t.test(
    "PRESERVE: the shared profile route and the tendero responses are unchanged",
    async () => {
      // PATCH /auth/me ignores a birth date: only the customer route stores one.
      const customer = await newCustomer("preserve-client");
      const patched = await call("PATCH", "/auth/me", {
        token: customer.session.accessToken,
        body: { fullName: "Camila Vega", birthDate: adultBirthDate },
      });
      assert.equal(patched.status, 200);
      const patchedBody = (await patched.json()) as OtpVerifyResponse;
      assert.deepEqual(Object.keys(patchedBody.user).sort(), [
        "active",
        "email",
        "emailVerifiedAt",
        "fullName",
        "id",
        "registrationStatus",
        "role",
      ]);
      assert.equal((await stored(customer.user.id)).birth_date, null);

      // A tendero's whole onboarding keeps its shape, with no birth date key.
      const tendero = await verified(uniqueEmail("preserve-tendero"));
      assert.equal("birthDate" in tendero.user, false);
      const token = tendero.session.accessToken;
      const named = await call("PATCH", "/auth/me", {
        token,
        body: { fullName: "Rosa Pardo" },
      });
      const namedUser = ((await named.json()) as OtpVerifyResponse).user;
      assert.equal(namedUser.registrationStatus, "store_required");
      assert.equal("birthDate" in namedUser, false);
      const me = await call("GET", "/auth/me", { token });
      assert.equal(
        "birthDate" in ((await me.json()) as OtpVerifyResponse).user,
        false,
      );

      // A tendero route needs no birth date and is not gated.
      const created = await call("POST", "/api/v1/tenderos/stores", {
        token,
        body: { name: `Tienda perfil ${runId}` },
      });
      assert.equal(created.status, 201, await created.clone().text());
      const mine = await call("GET", "/api/v1/tenderos/stores/me", { token });
      assert.equal(mine.status, 200);
    },
  );
});
