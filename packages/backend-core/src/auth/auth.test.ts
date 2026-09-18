import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { createAuthService } from "./service.js";
import { otpVerifySchema } from "./schemas.js";
import { createDatabaseConnection } from "../database/connection.js";
import { createAuthLogsRepository } from "../database/repositories/auth-logs.repository.js";
import { createUsersRepository } from "../database/repositories/users.repository.js";
import {
  authEvents,
  authRateLimits,
  authSessions,
  otpChallenges,
  otpRequestLeases,
  roles,
  stores,
  users,
} from "../database/schema.js";
import type { BackendEnv } from "../types/env.js";
import { AppError, createErrorHandler } from "../errors.js";

const env: BackendEnv = {
  serviceName: "auth-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "auth-tests",
  authJwtAudience: "savanhi-api",
  trustProxy: false,
  otpProvider: "development",
  otpDevCode: "123456",
  rateLimits: {
    api: 100,
    otpRequest: 100,
    otpVerify: 100,
    refresh: 10,
  },
};

test("OTP verification contract requires a challenge id", () => {
  assert.equal(
    otpVerifySchema.safeParse({ email: "user@example.test", token: "123456" })
      .success,
    false,
  );
  assert.equal(
    otpVerifySchema.safeParse({
      email: "user@example.test",
      challengeId: randomUUID(),
      token: "123456",
    }).success,
    true,
  );
});

test("auth errors serialize a stable machine-readable code", () => {
  let statusCode = 0;
  let retryAfter = "";
  let payload: unknown;
  const response = {
    setHeader(_name: string, value: string) {
      retryAfter = value;
    },
    status(value: number) {
      statusCode = value;
      return this;
    },
    json(value: unknown) {
      payload = value;
      return this;
    },
  };

  createErrorHandler(env)(
    new AppError(
      "Too many requests.",
      429,
      { retryAfterSeconds: 12 },
      "rate_limited",
    ),
    {} as never,
    response as never,
    (() => undefined) as never,
  );

  assert.equal(statusCode, 429);
  assert.equal(retryAfter, "12");
  assert.deepEqual(payload, {
    error: "Too many requests.",
    code: "rate_limited",
    details: { retryAfterSeconds: 12 },
  });
});

test("passwordless auth enforces verification, account status, and token rotation", async (t) => {
  const db = createDatabaseConnection(env);
  const authLogs = createAuthLogsRepository(db);
  const service = createAuthService(db, {
    env,
    authLogs,
    users: createUsersRepository(db),
  });
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, "tendero"));
  assert.ok(role, "local seed must provide the tendero role");

  const runId = randomUUID();
  const requestPrefix = `auth-test-${runId}`;
  const testEmails: string[] = [];
  const testIps = new Set<string>();
  const userIds: string[] = [];
  let requestSequence = 0;
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const meta = (ip = "unknown") => {
    testIps.add(ip);
    return { requestId: `${requestPrefix}-${requestSequence++}`, ip };
  };
  const uniqueEmail = (label: string) => {
    const email = `${label}-${runId}@example.test`;
    testEmails.push(email);
    return email;
  };
  const insertUser = async ({
    email,
    active = true,
    verified = false,
    registrationStatus = "profile_required" as const,
  }: {
    email: string;
    active?: boolean;
    verified?: boolean;
    registrationStatus?: "profile_required" | "store_required" | "completed";
  }) => {
    const [user] = await db
      .insert(users)
      .values({
        roleId: role.id,
        email,
        emailNormalized: email,
        fullName: "Existing User",
        active,
        emailVerifiedAt: verified ? new Date() : null,
        registrationStatus,
      })
      .returning();
    assert.ok(user);
    userIds.push(user.id);
    return user;
  };

  t.after(async () => {
    await db
      .delete(authEvents)
      .where(like(authEvents.requestId, `${requestPrefix}-%`));
    if (testEmails.length > 0) {
      await db
        .delete(otpRequestLeases)
        .where(inArray(otpRequestLeases.emailNormalized, testEmails));
      await db
        .delete(otpChallenges)
        .where(inArray(otpChallenges.emailNormalized, testEmails));
    }
    const rateLimitKeys = [
      ...[...testIps].map(digest),
      ...testEmails.flatMap((email) => [
        digest(email),
        ...[...testIps].map((ip) => digest(`${ip}\0${email}`)),
      ]),
    ];
    if (rateLimitKeys.length > 0) {
      await db
        .delete(authRateLimits)
        .where(inArray(authRateLimits.key, rateLimitKeys));
    }
    for (const userId of userIds) {
      await db.delete(stores).where(eq(stores.ownerUserId, userId));
      await db.delete(authEvents).where(eq(authEvents.userId, userId));
      await db.delete(authSessions).where(eq(authSessions.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    await db.pool.end();
  });

  await t.test(
    "advances profile_required to store_required without degrading completed",
    async () => {
      const account = await insertUser({
        email: uniqueEmail("profile-status"),
        verified: true,
      });

      const updated = await service.updateProfile(account.id, {
        fullName: "Updated Name",
      });
      assert.equal(updated.fullName, "Updated Name");
      assert.equal(updated.registrationStatus, "store_required");

      await db
        .update(users)
        .set({ registrationStatus: "completed" })
        .where(eq(users.id, account.id));
      const completed = await service.updateProfile(account.id, {
        fullName: "Completed Name",
      });
      assert.equal(completed.fullName, "Completed Name");
      assert.equal(completed.registrationStatus, "completed");
    },
  );

  await t.test(
    "keeps the previous challenge active when the provider rejects a resend",
    async () => {
      const email = uniqueEmail("provider-failure");
      let shouldFail = false;
      const providerService = createAuthService(db, {
        env,
        authLogs,
        users: createUsersRepository(db),
        otpProvider: {
          async sendOtp() {
            if (shouldFail) throw new Error("provider unavailable");
          },
        },
      });
      await providerService.requestOtp(email, meta("10.10.0.1"));
      await db
        .update(otpChallenges)
        .set({ cooldownUntil: new Date(0) })
        .where(eq(otpChallenges.emailNormalized, email));
      const [previous] = await db
        .select()
        .from(otpChallenges)
        .where(eq(otpChallenges.emailNormalized, email));
      assert.ok(previous);

      shouldFail = true;
      await assert.rejects(
        () => providerService.requestOtp(email, meta("10.10.0.1")),
        (error: unknown) =>
          error instanceof AppError && error.code === "provider_error",
      );
      const challenges = await db
        .select()
        .from(otpChallenges)
        .where(eq(otpChallenges.emailNormalized, email));
      assert.equal(challenges.length, 1);
      assert.equal(challenges[0]?.id, previous.id);
      assert.equal(challenges[0]?.lockedAt, null);
      const leases = await db
        .select()
        .from(otpRequestLeases)
        .where(eq(otpRequestLeases.emailNormalized, email));
      assert.equal(leases.length, 0);
    },
  );

  await t.test("recovers an expired OTP request lease", async () => {
    const email = uniqueEmail("expired-lease");
    await db.insert(otpRequestLeases).values({
      emailNormalized: email,
      leaseToken: randomUUID(),
      expiresAt: new Date(0),
    });

    const requested = await service.requestOtp(email, meta("10.10.0.8"));
    assert.ok(requested.challengeId);
    const leases = await db
      .select()
      .from(otpRequestLeases)
      .where(eq(otpRequestLeases.emailNormalized, email));
    assert.equal(leases.length, 0);
  });

  await t.test(
    "serializes concurrent OTP requests and leaves one active challenge",
    async () => {
      const email = uniqueEmail("concurrent-otp");
      let sends = 0;
      const serviceOptions = {
        env,
        authLogs,
        users: createUsersRepository(db),
        otpProvider: {
          async sendOtp() {
            sends += 1;
            await new Promise((resolve) => setTimeout(resolve, 25));
          },
        },
      };
      const firstReplica = createAuthService(db, serviceOptions);
      const secondReplica = createAuthService(db, serviceOptions);
      const results = await Promise.allSettled([
        firstReplica.requestOtp(email, meta("10.10.0.2")),
        secondReplica.requestOtp(email, meta("10.10.0.2")),
      ]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(sends, 1);
      const active = await db
        .select()
        .from(otpChallenges)
        .where(
          and(
            eq(otpChallenges.emailNormalized, email),
            isNull(otpChallenges.consumedAt),
            isNull(otpChallenges.lockedAt),
          ),
        );
      assert.equal(active.length, 1);
    },
  );

  await t.test("applies persistent OTP request limits by IP", async () => {
    const limitedService = createAuthService(db, {
      env: {
        ...env,
        rateLimits: { ...env.rateLimits, otpRequest: 2 },
      },
      authLogs,
      users: createUsersRepository(db),
      otpProvider: { async sendOtp() {} },
    });
    await limitedService.requestOtp(
      uniqueEmail("rate-ip-1"),
      meta("10.10.0.3"),
    );
    await limitedService.requestOtp(
      uniqueEmail("rate-ip-2"),
      meta("10.10.0.3"),
    );
    const blockedEmail = uniqueEmail("rate-ip-3");
    await assert.rejects(
      () => limitedService.requestOtp(blockedEmail, meta("10.10.0.3")),
      (error: unknown) =>
        error instanceof Error &&
        "statusCode" in error &&
        error.statusCode === 429 &&
        error instanceof AppError &&
        error.code === "rate_limited" &&
        "details" in error &&
        typeof error.details === "object" &&
        error.details !== null &&
        "retryAfterSeconds" in error.details,
    );
    const downstreamBuckets = await db
      .select()
      .from(authRateLimits)
      .where(
        inArray(authRateLimits.key, [
          digest(blockedEmail),
          digest(`10.10.0.3\0${blockedEmail}`),
        ]),
      );
    assert.equal(downstreamBuckets.length, 0);
  });

  await t.test(
    "persists request and verify buckets for every rate-limit dimension",
    async () => {
      const email = uniqueEmail("rate-dimensions");
      const ip = "10.10.0.4";
      const requested = await service.requestOtp(email, meta(ip));
      await assert.rejects(
        () =>
          service.verifyOtp(
            { email, challengeId: requested.challengeId, token: "000000" },
            meta(ip),
          ),
        /Incorrect verification code|Verification code expired/,
      );

      for (const action of ["otp_request", "otp_verify"] as const) {
        const buckets = await db
          .select({ scope: authRateLimits.scope })
          .from(authRateLimits)
          .where(
            and(
              eq(authRateLimits.action, action),
              inArray(authRateLimits.key, [
                digest(ip),
                digest(email),
                digest(`${ip}\0${email}`),
              ]),
            ),
          );
        assert.deepEqual(
          new Set(buckets.map((bucket) => bucket.scope)),
          new Set(["ip", "email", "ip_email"]),
        );
      }
    },
  );

  await t.test(
    "distinguishes incorrect and expired OTP challenges",
    async () => {
      const email = uniqueEmail("otp-error-codes");
      const requested = await service.requestOtp(email, meta("10.10.0.9"));

      await assert.rejects(
        () =>
          service.verifyOtp(
            { email, challengeId: requested.challengeId, token: "000000" },
            meta("10.10.0.9"),
          ),
        (error: unknown) =>
          error instanceof AppError && error.code === "incorrect_code",
      );

      await db
        .update(otpChallenges)
        .set({ expiresAt: new Date(0) })
        .where(eq(otpChallenges.id, requested.challengeId));
      await assert.rejects(
        () =>
          service.verifyOtp(
            { email, challengeId: requested.challengeId, token: "123456" },
            meta("10.10.0.9"),
          ),
        (error: unknown) =>
          error instanceof AppError && error.code === "expired_code",
      );
    },
  );

  await t.test(
    "targets one challenge without incrementing its replacement",
    async () => {
      const email = uniqueEmail("challenge-identity");
      const sentCodes: string[] = [];
      const identityService = createAuthService(db, {
        env: { ...env, otpDevCode: undefined },
        authLogs,
        users: createUsersRepository(db),
        otpProvider: {
          async sendOtp(_email, code) {
            sentCodes.push(code);
          },
        },
      });
      const first = await identityService.requestOtp(email, meta("10.10.0.5"));
      const otherEmail = uniqueEmail("challenge-owner");
      await assert.rejects(
        () =>
          identityService.verifyOtp(
            {
              email: otherEmail,
              challengeId: first.challengeId,
              token: sentCodes[0]!,
            },
            meta("10.10.0.7"),
          ),
        /Incorrect verification code|Verification code expired/,
      );
      const [ownedChallenge] = await db
        .select()
        .from(otpChallenges)
        .where(eq(otpChallenges.id, first.challengeId));
      assert.equal(ownedChallenge?.attempts, 0);

      await db
        .update(otpChallenges)
        .set({ cooldownUntil: new Date(0) })
        .where(eq(otpChallenges.id, first.challengeId));
      const second = await identityService.requestOtp(email, meta("10.10.0.6"));
      assert.notEqual(first.challengeId, second.challengeId);

      await assert.rejects(
        () =>
          identityService.verifyOtp(
            {
              email,
              challengeId: first.challengeId,
              token: sentCodes[0]!,
            },
            meta("10.10.0.7"),
          ),
        /Incorrect verification code|Verification code expired/,
      );
      const [replacement] = await db
        .select()
        .from(otpChallenges)
        .where(eq(otpChallenges.id, second.challengeId));
      assert.equal(replacement?.attempts, 0);

      const verified = await identityService.verifyOtp(
        {
          email,
          challengeId: second.challengeId,
          token: sentCodes[1]!,
        },
        meta("10.10.0.7"),
      );
      userIds.push(verified.user.id);
    },
  );

  await t.test(
    "completes registration transactionally without duplicate stores",
    async () => {
      const email = uniqueEmail("complete-registration");
      const account = await insertUser({ email, verified: true });
      const payload = {
        fullName: "Completed User",
        store: { name: "Only Store", paymentMethod: "efectivo" as const },
      };
      const [first, second] = await Promise.all([
        service.completeRegistration(account.id, payload),
        service.completeRegistration(account.id, payload),
      ]);
      assert.equal(first.storeId, second.storeId);
      assert.equal(first.user.registrationStatus, "completed");
      assert.equal(second.user.fullName, "Completed User");
      const ownedStores = await db
        .select()
        .from(stores)
        .where(eq(stores.ownerUserId, account.id));
      assert.equal(ownedStores.length, 1);
      const [updated] = await db
        .select()
        .from(users)
        .where(eq(users.id, account.id));
      assert.equal(updated?.registrationStatus, "completed");
      assert.equal(updated?.fullName, "Completed User");
    },
  );

  await t.test(
    "creates a canonical verified user and session atomically",
    async () => {
      const email = uniqueEmail("new-user");
      const requested = await service.requestOtp(email.toUpperCase(), meta());
      await assert.rejects(
        () =>
          service.verifyOtp(
            { email, challengeId: requested.challengeId, token: "000000" },
            meta(),
          ),
        /Incorrect verification code|Verification code expired/,
      );

      const verified = await service.verifyOtp(
        { email, challengeId: requested.challengeId, token: "123456" },
        meta(),
      );
      userIds.push(verified.user.id);
      assert.equal(verified.isNewUser, true);
      assert.equal(verified.user.email, email);
      assert.equal(verified.user.emailVerifiedAt !== null, true);
      assert.equal(verified.user.registrationStatus, "profile_required");
      assert.equal(verified.user.active, true);

      const [stored] = await db
        .select()
        .from(users)
        .where(eq(users.id, verified.user.id));
      assert.equal(
        stored?.emailVerifiedAt?.toISOString(),
        verified.user.emailVerifiedAt,
      );
      assert.equal(stored?.registrationStatus, "profile_required");
      const sessions = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, verified.user.id));
      assert.equal(sessions.length, 1);

      await assert.rejects(
        () =>
          service.verifyOtp(
            { email, challengeId: requested.challengeId, token: "123456" },
            meta(),
          ),
        /Incorrect verification code|Verification code expired/,
      );

      const initialRefresh = verified.session.refreshToken;
      assert.ok(initialRefresh);
      const rotated = await service.refreshSession(initialRefresh, meta());
      assert.notEqual(rotated.refreshToken, initialRefresh);
      await service.getUserFromAccessToken(rotated.accessToken);

      await db
        .update(users)
        .set({ emailVerifiedAt: null })
        .where(eq(users.id, verified.user.id));
      await assert.rejects(
        () => service.getUserFromAccessToken(rotated.accessToken),
        /Invalid or expired access token/,
      );
      await assert.rejects(
        () => service.refreshSession(rotated.refreshToken!, meta()),
        /Invalid refresh token/,
      );
      const family = await db
        .select({ revokedAt: authSessions.revokedAt })
        .from(authSessions)
        .where(eq(authSessions.userId, verified.user.id));
      assert.ok(family.length >= 2);
      assert.ok(family.every((session) => session.revokedAt !== null));
    },
  );

  await t.test(
    "verifies an existing user without changing registration status",
    async () => {
      const email = uniqueEmail("existing-user");
      const existing = await insertUser({
        email,
        registrationStatus: "completed",
      });
      const requested = await service.requestOtp(email, meta());
      const verified = await service.verifyOtp(
        { email, challengeId: requested.challengeId, token: "123456" },
        meta(),
      );
      assert.equal(verified.isNewUser, false);
      assert.equal(verified.user.id, existing.id);
      assert.equal(verified.user.emailVerifiedAt !== null, true);
      assert.equal(verified.user.registrationStatus, "completed");

      await db
        .update(users)
        .set({ active: false })
        .where(eq(users.id, existing.id));
      await assert.rejects(
        () => service.getUserFromAccessToken(verified.session.accessToken),
        /Invalid or expired access token/,
      );
      await assert.rejects(
        () => service.refreshSession(verified.session.refreshToken!, meta()),
        /Invalid refresh token/,
      );
      const sessions = await db
        .select({ revokedAt: authSessions.revokedAt })
        .from(authSessions)
        .where(eq(authSessions.userId, existing.id));
      assert.ok(sessions.every((session) => session.revokedAt !== null));
    },
  );

  await t.test(
    "locks OTP after the maximum attempts and creates no user or session",
    async () => {
      const email = uniqueEmail("attempts");
      const requested = await service.requestOtp(email, meta());
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await assert.rejects(
          () =>
            service.verifyOtp(
              { email, challengeId: requested.challengeId, token: "000000" },
              meta(),
            ),
          /Incorrect verification code|Verification code expired/,
        );
      }
      await assert.rejects(
        () =>
          service.verifyOtp(
            { email, challengeId: requested.challengeId, token: "123456" },
            meta(),
          ),
        /Incorrect verification code|Verification code expired/,
      );

      const [challenge] = await db
        .select()
        .from(otpChallenges)
        .where(eq(otpChallenges.emailNormalized, email));
      assert.equal(challenge?.attempts, 5);
      assert.ok(challenge?.lockedAt);
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.emailNormalized, email));
      assert.equal(user, undefined);
    },
  );

  await t.test(
    "rejects an inactive user even when the challenge predates deactivation",
    async () => {
      const email = uniqueEmail("inactive-user");
      const existing = await insertUser({ email });
      const requested = await service.requestOtp(email, meta());
      await db
        .update(users)
        .set({ active: false })
        .where(eq(users.id, existing.id));

      await assert.rejects(
        () =>
          service.verifyOtp(
            { email, challengeId: requested.challengeId, token: "123456" },
            meta(),
          ),
        /Account is disabled/,
      );
      const sessions = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, existing.id));
      assert.equal(sessions.length, 0);
      const [challenge] = await db
        .select()
        .from(otpChallenges)
        .where(eq(otpChallenges.emailNormalized, email));
      assert.ok(challenge?.lockedAt);
      assert.equal(challenge?.consumedAt, null);

      const challengeCount = await db
        .select({ id: otpChallenges.id })
        .from(otpChallenges)
        .where(eq(otpChallenges.emailNormalized, email));
      await assert.rejects(
        () => service.requestOtp(email, meta()),
        /Account is disabled/,
      );
      const afterRequest = await db
        .select({ id: otpChallenges.id })
        .from(otpChallenges)
        .where(eq(otpChallenges.emailNormalized, email));
      assert.equal(afterRequest.length, challengeCount.length);
    },
  );

  const events = await db
    .select()
    .from(authEvents)
    .where(like(authEvents.requestId, `${requestPrefix}-%`));
  assert.ok(events.length > 0);
  assert.ok(
    events.every(
      (event) =>
        !event.emailHash?.includes("123456") &&
        !event.reason?.includes("123456"),
    ),
  );
});
