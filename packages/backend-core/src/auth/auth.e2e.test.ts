import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type {
  AuthErrorResponse,
  OtpRequestResponse,
  OtpVerifyResponse,
  RegistrationStatus,
} from "@repo/api-contracts/auth";
import { eq, inArray, like } from "drizzle-orm";
import { createAuthRouter } from "./router.js";
import { createBackendApp } from "../app.js";
import { createBackendContext } from "../context/backend-context.js";
import { createDatabaseConnection } from "../database/connection.js";
import {
  authEvents,
  authRateLimits,
  otpChallenges,
  otpRequestLeases,
  roles,
  stores,
  users,
} from "../database/schema.js";
import type { BackendEnv } from "../types/env.js";

const env: BackendEnv = {
  serviceName: "auth-http-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "auth-http-tests",
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

type Harness = Awaited<ReturnType<typeof startHarness>>;

async function startHarness() {
  const context = createBackendContext(env, {
    defaultRegistrationRole: "tendero",
  });
  const { authRouter } = createAuthRouter(context.authService, {
    limits: context.env.rateLimits,
  });
  const server = createBackendApp({ env, routers: [authRouter] }).listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    context,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await context.db.pool.end();
    },
  };
}

test("Tenderos auth works through HTTP and PostgreSQL", async (t) => {
  const cleanupDb = createDatabaseConnection(env);
  const runId = randomUUID();
  const requestPrefix = `auth-e2e-${runId}`;
  const emails: string[] = [];
  const userIds: string[] = [];
  let requestSequence = 0;
  let harness: Harness | null = await startHarness();

  const uniqueEmail = (label: string) => {
    const email = `${label}-${runId}@example.test`;
    emails.push(email);
    return email;
  };
  const request = async <T>(
    path: string,
    body: object,
  ): Promise<{ response: Response; body: T }> => {
    assert.ok(harness);
    const response = await fetch(`${harness.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": `${requestPrefix}-${requestSequence++}`,
      },
      body: JSON.stringify(body),
    });
    return { response, body: (await response.json()) as T };
  };
  const requestOtp = async (email: string) => {
    const result = await request<OtpRequestResponse>("/auth/otp/request", {
      email,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.ok, true);
    return result.body;
  };
  const verifyOtp = (email: string, challengeId: string, token = "123456") =>
    request<OtpVerifyResponse | AuthErrorResponse>("/auth/otp/verify", {
      email,
      challengeId,
      token,
    });
  const insertUser = async (
    email: string,
    registrationStatus: RegistrationStatus,
  ) => {
    const [role] = await cleanupDb
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, "tendero"));
    assert.ok(role, "database seed must provide the tendero role");
    const [created] = await cleanupDb
      .insert(users)
      .values({
        roleId: role.id,
        email,
        emailNormalized: email,
        fullName: "Existing User",
        registrationStatus,
      })
      .returning({ id: users.id });
    assert.ok(created);
    userIds.push(created.id);
    return created;
  };

  t.after(async () => {
    if (harness) await harness.close();
    await cleanupDb
      .delete(authEvents)
      .where(like(authEvents.requestId, `${requestPrefix}-%`));
    if (emails.length > 0) {
      await cleanupDb
        .delete(otpRequestLeases)
        .where(inArray(otpRequestLeases.emailNormalized, emails));
      await cleanupDb
        .delete(otpChallenges)
        .where(inArray(otpChallenges.emailNormalized, emails));
    }
    for (const userId of userIds) {
      await cleanupDb.delete(stores).where(eq(stores.ownerUserId, userId));
      await cleanupDb.delete(users).where(eq(users.id, userId));
    }

    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const ips = ["127.0.0.1", "::1", "::ffff:127.0.0.1", "unknown"];
    const rateLimitKeys = [
      ...ips.map(digest),
      ...emails.flatMap((email) => [
        digest(email),
        ...ips.map((ip) => digest(`${ip}\0${email}`)),
      ]),
    ];
    await cleanupDb
      .delete(authRateLimits)
      .where(inArray(authRateLimits.key, rateLimitKeys));
    await cleanupDb.pool.end();
  });

  await t.test("creates a new user", async () => {
    const email = uniqueEmail("new-user");
    const challenge = await requestOtp(email);
    const verified = await verifyOtp(email, challenge.challengeId);

    assert.equal(verified.response.status, 200);
    const body = verified.body as OtpVerifyResponse;
    userIds.push(body.user.id);
    assert.equal(body.isNewUser, true);
    assert.equal(body.user.registrationStatus, "profile_required");
  });

  await t.test("returns an existing completed user", async () => {
    const email = uniqueEmail("completed-user");
    const existing = await insertUser(email, "completed");
    const challenge = await requestOtp(email);
    const verified = await verifyOtp(email, challenge.challengeId);

    assert.equal(verified.response.status, 200);
    const body = verified.body as OtpVerifyResponse;
    assert.equal(body.isNewUser, false);
    assert.equal(body.user.id, existing.id);
    assert.equal(body.user.registrationStatus, "completed");
  });

  await t.test("preserves incomplete profile and store states", async () => {
    for (const status of ["profile_required", "store_required"] as const) {
      const email = uniqueEmail(status);
      await insertUser(email, status);
      const challenge = await requestOtp(email);
      const verified = await verifyOtp(email, challenge.challengeId);

      assert.equal(verified.response.status, 200);
      assert.equal(
        (verified.body as OtpVerifyResponse).user.registrationStatus,
        status,
      );
    }
  });

  await t.test("returns the expired OTP machine state", async () => {
    const email = uniqueEmail("expired-otp");
    const challenge = await requestOtp(email);
    await cleanupDb
      .update(otpChallenges)
      .set({ expiresAt: new Date(0) })
      .where(eq(otpChallenges.id, challenge.challengeId));

    const verified = await verifyOtp(email, challenge.challengeId);
    assert.equal(verified.response.status, 401);
    assert.equal((verified.body as AuthErrorResponse).code, "expired_code");
  });

  await t.test("a resend replaces the old challenge", async () => {
    const email = uniqueEmail("resend");
    const first = await requestOtp(email);
    await cleanupDb
      .update(otpChallenges)
      .set({ cooldownUntil: new Date(0) })
      .where(eq(otpChallenges.id, first.challengeId));
    const second = await requestOtp(email);

    assert.notEqual(second.challengeId, first.challengeId);
    const staleVerification = await verifyOtp(email, first.challengeId);
    assert.equal(staleVerification.response.status, 401);
    assert.equal(
      (staleVerification.body as AuthErrorResponse).code,
      "expired_code",
    );

    const currentVerification = await verifyOtp(email, second.challengeId);
    assert.equal(currentVerification.response.status, 200);
    userIds.push((currentVerification.body as OtpVerifyResponse).user.id);
  });

  await t.test(
    "persists an OTP challenge across a service restart",
    async () => {
      const email = uniqueEmail("restart");
      const challenge = await requestOtp(email);

      assert.ok(harness);
      await harness.close();
      harness = null;
      harness = await startHarness();

      const verified = await verifyOtp(email, challenge.challengeId);
      assert.equal(verified.response.status, 200);
      userIds.push((verified.body as OtpVerifyResponse).user.id);
    },
  );
});
