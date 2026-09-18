import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type {
  AuthRole,
  AuthSession,
  AuthUser,
  CompleteRegistrationRequest,
  CompleteRegistrationResponse,
  OtpRequestResponse,
  OtpVerifyResponse,
} from "@repo/api-contracts/auth";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { DatabaseConnection } from "../database/connection.js";
import { mapProfile } from "../database/mappers.js";
import {
  authSessions,
  authRateLimits,
  otpChallenges,
  otpRequestLeases,
  roles,
  stores,
  users,
} from "../database/schema.js";
import type { createAuthLogsRepository } from "../database/repositories/auth-logs.repository.js";
import type { createUsersRepository } from "../database/repositories/users.repository.js";
import type { BackendEnv } from "../types/env.js";
import {
  createDevelopmentOtpProvider,
  createResendOtpProvider,
  type OtpProvider,
} from "./otp-provider.js";

const ACCESS_SECONDS = 15 * 60;
const REFRESH_DAYS = 30;
const OTP_SECONDS = 10 * 60;
const OTP_COOLDOWN_SECONDS = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_RETENTION_HOURS = 24;
const MAX_OTP_ATTEMPTS = 5;
export type AuthRequestMeta = {
  requestId?: string;
  ip?: string;
  userAgent?: string;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function constantTimeHashEquals(value: string, expected: string) {
  return crypto.timingSafeEqual(
    Buffer.from(hash(value)),
    Buffer.from(expected),
  );
}
function createRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

export function createAuthService(
  db: DatabaseConnection,
  {
    env,
    defaultRegistrationRole = "tendero" as AuthRole,
    authLogs,
    users: userRepository,
    otpProvider,
  }: {
    env: BackendEnv;
    defaultRegistrationRole?: AuthRole;
    authLogs?: ReturnType<typeof createAuthLogsRepository>;
    users: ReturnType<typeof createUsersRepository>;
    otpProvider?: OtpProvider;
  },
) {
  const provider =
    otpProvider ??
    (env.otpProvider === "resend"
      ? createResendOtpProvider(env.otpResend!)
      : createDevelopmentOtpProvider());
  const otpRequestLeaseMs =
    (env.otpProvider === "resend" ? (env.otpResend?.timeoutMs ?? 5000) : 5000) +
    10_000;
  function accessToken(userId: string, sessionId: string) {
    return jwt.sign(
      { sub: userId, sid: sessionId, typ: "access" },
      env.authJwtSecret,
      {
        algorithm: "HS256",
        expiresIn: ACCESS_SECONDS,
        issuer: env.authJwtIssuer,
        audience: env.authJwtAudience,
      },
    );
  }
  function createSession(
    userId: string,
    familyId = crypto.randomUUID(),
    rotation = 0,
  ) {
    const sessionId = crypto.randomUUID();
    const refreshToken = createRefreshToken();
    const access = accessToken(userId, sessionId);
    return {
      values: {
        id: sessionId,
        userId,
        tokenHash: hash(access),
        refreshTokenHash: hash(refreshToken),
        familyId,
        rotation,
        expiresAt: new Date(Date.now() + REFRESH_DAYS * 86400000),
      },
      session: {
        accessToken: access,
        refreshToken,
        expiresIn: ACCESS_SECONDS,
      } satisfies AuthSession,
    };
  }
  async function findCredentials(email: string) {
    const normalized = normalizeEmail(email);
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, normalized));
    return row;
  }
  async function audit(
    eventType: string,
    event: Omit<
      Parameters<NonNullable<typeof authLogs>["record"]>[0],
      "eventType"
    >,
  ) {
    await authLogs?.record({ ...event, eventType });
  }

  async function enforceOtpRateLimits(
    action: "otp_request" | "otp_verify",
    normalizedEmail: string,
    ip: string,
    limit: number,
  ) {
    await db
      .delete(authRateLimits)
      .where(
        sql`${authRateLimits.resetAt} < clock_timestamp() - (${RATE_LIMIT_RETENTION_HOURS} * interval '1 hour')`,
      );

    const consumeBucket = async (scope: string, key: string) => {
      const result = await db.execute<{
        count: number;
        retry_after_seconds: number;
      }>(sql`
        INSERT INTO "auth_rate_limits" (
          "action", "scope", "key", "count", "reset_at", "updated_at"
        ) VALUES (
          ${action}, ${scope}, ${key}, 1,
          clock_timestamp() + (${RATE_LIMIT_WINDOW_MS} * interval '1 millisecond'),
          clock_timestamp()
        )
        ON CONFLICT ("action", "scope", "key") DO UPDATE SET
          "count" = CASE
            WHEN "auth_rate_limits"."reset_at" <= clock_timestamp() THEN 1
            ELSE "auth_rate_limits"."count" + 1
          END,
          "reset_at" = CASE
            WHEN "auth_rate_limits"."reset_at" <= clock_timestamp()
              THEN clock_timestamp() + (${RATE_LIMIT_WINDOW_MS} * interval '1 millisecond')
            ELSE "auth_rate_limits"."reset_at"
          END,
          "updated_at" = clock_timestamp()
        RETURNING
          "count",
          greatest(
            1,
            ceil(extract(epoch from ("reset_at" - clock_timestamp())))
          )::integer AS "retry_after_seconds"
      `);
      const bucket = result.rows[0];
      if (bucket && bucket.count > limit) {
        throw new AppError("Too many requests. Try again later.", 429, {
          retryAfterSeconds: bucket.retry_after_seconds,
        }, "rate_limited");
      }
    };

    await consumeBucket("ip", hash(ip));
    await consumeBucket("email", hash(normalizedEmail));
    await consumeBucket("ip_email", hash(`${ip}\0${normalizedEmail}`));
  }

  async function acquireOtpRequestLease(normalizedEmail: string) {
    const leaseToken = crypto.randomUUID();
    const acquired = await db.execute<{ lease_token: string }>(sql`
      INSERT INTO "otp_request_leases" (
        "email_normalized", "lease_token", "expires_at", "created_at", "updated_at"
      ) VALUES (
        ${normalizedEmail}, ${leaseToken},
        clock_timestamp() + (${otpRequestLeaseMs} * interval '1 millisecond'),
        clock_timestamp(), clock_timestamp()
      )
      ON CONFLICT ("email_normalized") DO UPDATE SET
        "lease_token" = excluded."lease_token",
        "expires_at" = excluded."expires_at",
        "updated_at" = clock_timestamp()
      WHERE "otp_request_leases"."expires_at" <= clock_timestamp()
      RETURNING "lease_token"
    `);
    if (acquired.rows[0]?.lease_token === leaseToken) return leaseToken;

    const existing = await db.execute<{ retry_after_seconds: number }>(sql`
      SELECT greatest(
        1,
        ceil(extract(epoch from ("expires_at" - clock_timestamp())))
      )::integer AS "retry_after_seconds"
      FROM "otp_request_leases"
      WHERE "email_normalized" = ${normalizedEmail}
    `);
    throw new AppError("Too many requests. Try again later.", 429, {
      retryAfterSeconds: existing.rows[0]?.retry_after_seconds ?? 1,
    }, "rate_limited");
  }

  async function releaseOtpRequestLease(
    normalizedEmail: string,
    leaseToken: string,
  ) {
    await db
      .delete(otpRequestLeases)
      .where(
        and(
          eq(otpRequestLeases.emailNormalized, normalizedEmail),
          eq(otpRequestLeases.leaseToken, leaseToken),
        ),
      );
  }

  async function enforceOtpCooldown(normalizedEmail: string) {
    const result = await db.execute<{ retry_after_seconds: number }>(sql`
      SELECT greatest(
        1,
        ceil(extract(epoch from ("cooldown_until" - clock_timestamp())))
      )::integer AS "retry_after_seconds"
      FROM "otp_challenges"
      WHERE "email_normalized" = ${normalizedEmail}
        AND "consumed_at" IS NULL
        AND "locked_at" IS NULL
        AND "cooldown_until" > clock_timestamp()
      ORDER BY "created_at" DESC
      LIMIT 1
    `);
    const cooldown = result.rows[0];
    if (cooldown) {
      throw new AppError("Too many requests. Try again later.", 429, {
        retryAfterSeconds: cooldown.retry_after_seconds,
      }, "rate_limited");
    }
  }

  return {
    async requestOtp(
      email: string,
      meta: AuthRequestMeta = {},
    ): Promise<OtpRequestResponse> {
      const normalized = normalizeEmail(email);
      await enforceOtpRateLimits(
        "otp_request",
        normalized,
        meta.ip ?? "unknown",
        env.rateLimits.otpRequest,
      );
      const existing = await findCredentials(normalized);
      if (existing && !existing.active) {
        await audit("otp_request", {
          userId: existing.id,
          email,
          outcome: "failure",
          reason: "inactive_user",
          ...meta,
        });
        throw new AppError("Account is disabled.", 403);
      }
      const leaseToken = await acquireOtpRequestLease(normalized);
      let providerFailed = false;
      try {
        await enforceOtpCooldown(normalized);
        const code =
          env.otpDevCode ?? String(crypto.randomInt(100000, 1000000));
        try {
          await provider.sendOtp(normalized, code);
        } catch {
          providerFailed = true;
          throw new AppError(
            "No pudimos enviar el código. Revisá el correo del remitente y la configuración de Resend.",
            503,
            undefined,
            "provider_error",
          );
        }

        const challengeId = crypto.randomUUID();
        const result = await db.transaction(async (tx) => {
          const [ownedLease] = await tx
            .select({ leaseToken: otpRequestLeases.leaseToken })
            .from(otpRequestLeases)
            .where(
              and(
                eq(otpRequestLeases.emailNormalized, normalized),
                eq(otpRequestLeases.leaseToken, leaseToken),
                gt(otpRequestLeases.expiresAt, sql`clock_timestamp()`),
              ),
            )
            .for("update");
          if (!ownedLease) {
            throw new AppError(
              "OTP request lease expired.",
              503,
              undefined,
              "provider_error",
            );
          }

          await tx
            .update(otpChallenges)
            .set({ lockedAt: sql`clock_timestamp()` })
            .where(
              and(
                eq(otpChallenges.emailNormalized, normalized),
                isNull(otpChallenges.consumedAt),
                isNull(otpChallenges.lockedAt),
              ),
            );
          await tx.insert(otpChallenges).values({
            id: challengeId,
            emailNormalized: normalized,
            codeHash: hash(`${normalized}:${code}:${env.authJwtSecret}`),
            expiresAt: sql`clock_timestamp() + (${OTP_SECONDS} * interval '1 second')`,
            cooldownUntil: sql`clock_timestamp() + (${OTP_COOLDOWN_SECONDS} * interval '1 second')`,
          });
          await tx
            .delete(otpRequestLeases)
            .where(
              and(
                eq(otpRequestLeases.emailNormalized, normalized),
                eq(otpRequestLeases.leaseToken, leaseToken),
              ),
            );
          return {
            ok: true,
            challengeId,
            cooldownSeconds: OTP_COOLDOWN_SECONDS,
          } as const;
        });
        await audit("otp_request", { email, outcome: "success", ...meta });
        return result;
      } catch (error) {
        if (providerFailed) {
          await audit("otp_provider_failure", {
            email,
            outcome: "failure",
            reason: "provider_unavailable",
            ...meta,
          });
        }
        throw error;
      } finally {
        await releaseOtpRequestLease(normalized, leaseToken);
      }
    },
    async verifyOtp(
      {
        email,
        challengeId,
        token,
      }: {
        email: string;
        challengeId: string;
        token: string;
      },
      meta: AuthRequestMeta = {},
    ): Promise<OtpVerifyResponse> {
      const normalized = normalizeEmail(email);
      await enforceOtpRateLimits(
        "otp_verify",
        normalized,
        meta.ip ?? "unknown",
        env.rateLimits.otpVerify,
      );
      const result = await db.transaction(async (tx) => {
        const [challenge] = await tx
          .select()
          .from(otpChallenges)
          .where(
            and(
              eq(otpChallenges.emailNormalized, normalized),
              eq(otpChallenges.id, challengeId),
            ),
          )
          .limit(1)
          .for("update");
        if (
          !challenge ||
          challenge.consumedAt !== null ||
          challenge.lockedAt !== null ||
          challenge.expiresAt <= new Date()
        ) {
          return { kind: "expired" as const };
        }
        if (
          challenge.attempts >= MAX_OTP_ATTEMPTS ||
          !constantTimeHashEquals(
            `${normalized}:${token}:${env.authJwtSecret}`,
            challenge.codeHash,
          )
        ) {
          const attempts = challenge.attempts + 1;
          await tx
            .update(otpChallenges)
            .set({
              attempts,
              lockedAt: attempts >= MAX_OTP_ATTEMPTS ? new Date() : null,
            })
            .where(eq(otpChallenges.id, challenge.id));
          return { kind: "incorrect" as const };
        }
        let [user] = await tx
          .select()
          .from(users)
          .where(eq(users.emailNormalized, normalized))
          .for("update");
        if (user && !user.active) {
          await tx
            .update(otpChallenges)
            .set({ lockedAt: new Date() })
            .where(eq(otpChallenges.id, challenge.id));
          return { kind: "inactive" as const };
        }
        let isNewUser = false;
        const verifiedAt = new Date();
        if (!user) {
          isNewUser = true;
          const [role] = await tx
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.name, defaultRegistrationRole));
          if (!role) {
            throw new AppError(
              `Role ${defaultRegistrationRole} is not configured.`,
              500,
            );
          }
          const [created] = await tx
            .insert(users)
            .values({
              email: normalized,
              emailNormalized: normalized,
              fullName: "",
              roleId: role.id,
              emailVerifiedAt: verifiedAt,
              registrationStatus: "profile_required",
            })
            .returning();
          user = created;
        } else if (!user.emailVerifiedAt) {
          [user] = await tx
            .update(users)
            .set({ emailVerifiedAt: verifiedAt, updatedAt: verifiedAt })
            .where(eq(users.id, user.id))
            .returning();
        }
        if (!user) throw new AppError("Unable to create user.", 502);
        await tx
          .update(otpChallenges)
          .set({ consumedAt: verifiedAt })
          .where(eq(otpChallenges.id, challenge.id));
        const [profile] = await tx
          .select({ user: users, roleName: roles.name })
          .from(users)
          .innerJoin(roles, eq(users.roleId, roles.id))
          .where(eq(users.id, user.id));
        if (!profile) {
          throw new AppError("Unable to read authenticated user.", 401);
        }
        const issued = createSession(user.id);
        await tx.insert(authSessions).values(issued.values);
        return {
          kind: "verified" as const,
          user: mapProfile({ ...profile.user, roleName: profile.roleName }),
          session: issued.session,
          isNewUser,
        };
      });
      if (result?.kind === "inactive") {
        await audit("otp_verify", {
          email,
          outcome: "failure",
          reason: "inactive_user",
          ...meta,
        });
        throw new AppError("Account is disabled.", 403);
      }
      if (result?.kind === "expired") {
        await audit("otp_verify", {
          email,
          outcome: "failure",
          reason: "expired",
          ...meta,
        });
        throw new AppError(
          "Verification code expired. Request a new code.",
          401,
          undefined,
          "expired_code",
        );
      }
      if (result?.kind === "incorrect") {
        await audit("otp_verify", {
          email,
          outcome: "failure",
          reason: "incorrect",
          ...meta,
        });
        throw new AppError(
          "Incorrect verification code.",
          401,
          undefined,
          "incorrect_code",
        );
      }
      await audit("otp_verify", {
        userId: result.user.id,
        email,
        outcome: "success",
        ...meta,
      });
      return {
        user: result.user,
        session: result.session,
        isNewUser: result.isNewUser,
      };
    },
    async updateProfile(
      userId: string,
      payload: { fullName: string },
    ): Promise<AuthUser> {
      return userRepository.updateProfile(userId, payload);
    },
    async completeRegistration(
      userId: string,
      payload: CompleteRegistrationRequest,
    ): Promise<CompleteRegistrationResponse> {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
        );
        const [account] = await tx
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .for("update");
        if (!account) throw new AppError("User not found.", 404);

        const [existingStore] = await tx
          .select()
          .from(stores)
          .where(eq(stores.ownerUserId, userId))
          .orderBy(asc(stores.createdAt), asc(stores.id))
          .limit(1);

        let storeId = existingStore?.id;
        if (!storeId) {
          const [createdStore] = await tx
            .insert(stores)
            .values({
              ownerUserId: userId,
              name: payload.store.name,
              address: payload.store.address ?? null,
              latitude: payload.store.latitude ?? null,
              longitude: payload.store.longitude ?? null,
              paymentMethod: payload.store.paymentMethod ?? null,
            })
            .returning({ id: stores.id });
          if (!createdStore) throw new AppError("Unable to create store.", 502);
          storeId = createdStore.id;
        }

        if (account.registrationStatus !== "completed") {
          await tx
            .update(users)
            .set({
              fullName: payload.fullName,
              registrationStatus: "completed",
              updatedAt: new Date(),
            })
            .where(eq(users.id, userId));
        }

        const [profile] = await tx
          .select({ user: users, roleName: roles.name })
          .from(users)
          .innerJoin(roles, eq(users.roleId, roles.id))
          .where(eq(users.id, userId));
        if (!profile)
          throw new AppError("Unable to read authenticated user.", 502);
        return {
          user: mapProfile({ ...profile.user, roleName: profile.roleName }),
          storeId,
        };
      });
    },
    async refreshSession(
      refreshToken: string,
      meta: AuthRequestMeta = {},
    ): Promise<AuthSession> {
      const result = await db.transaction(async (tx) => {
        const [session] = await tx
          .select()
          .from(authSessions)
          .where(eq(authSessions.refreshTokenHash, hash(refreshToken)))
          .for("update");
        if (!session) return null;
        if (
          session.revokedAt ||
          session.rotatedAt ||
          session.expiresAt <= new Date()
        ) {
          await tx
            .update(authSessions)
            .set({ revokedAt: new Date() })
            .where(eq(authSessions.familyId, session.familyId));
          return null;
        }
        const [user] = await tx
          .select({
            active: users.active,
            emailVerifiedAt: users.emailVerifiedAt,
          })
          .from(users)
          .where(eq(users.id, session.userId))
          .for("update");
        if (!user?.active || !user.emailVerifiedAt) {
          await tx
            .update(authSessions)
            .set({ revokedAt: new Date() })
            .where(eq(authSessions.familyId, session.familyId));
          return null;
        }
        await tx
          .update(authSessions)
          .set({ rotatedAt: new Date(), revokedAt: new Date() })
          .where(eq(authSessions.id, session.id));
        const issued = createSession(
          session.userId,
          session.familyId as `${string}-${string}-${string}-${string}-${string}`,
          session.rotation + 1,
        );
        await tx.insert(authSessions).values(issued.values);
        return {
          session: issued.session,
          userId: session.userId,
          familyId: session.familyId,
        };
      });
      if (!result) {
        await audit("refresh", {
          outcome: "failure",
          reason: "invalid_reused_or_expired",
          ...meta,
        });
        throw new AppError("Invalid refresh token.", 401);
      }
      await audit("refresh", {
        userId: result.userId,
        familyId: result.familyId,
        outcome: "success",
        ...meta,
      });
      return result.session;
    },
    async getUserFromAccessToken(accessTokenValue: string): Promise<AuthUser> {
      try {
        const decoded = jwt.verify(accessTokenValue, env.authJwtSecret, {
          algorithms: ["HS256"],
          issuer: env.authJwtIssuer,
          audience: env.authJwtAudience,
        }) as { sub: string; sid: string; typ: string };
        if (decoded.typ !== "access") throw new Error("type");
        const [session] = await db
          .select({ id: authSessions.id })
          .from(authSessions)
          .where(
            and(
              eq(authSessions.id, decoded.sid),
              eq(authSessions.tokenHash, hash(accessTokenValue)),
              isNull(authSessions.revokedAt),
              isNull(authSessions.rotatedAt),
              gt(authSessions.expiresAt, new Date()),
            ),
          );
        if (!session) throw new Error("revoked");
        const [account] = await db
          .select({
            active: users.active,
            emailVerifiedAt: users.emailVerifiedAt,
          })
          .from(users)
          .where(eq(users.id, decoded.sub));
        if (!account?.active || !account.emailVerifiedAt) {
          throw new Error("inactive_or_unverified");
        }
        const user = await userRepository.findById(decoded.sub);
        if (!user) throw new Error("missing_user");
        return user;
      } catch {
        throw new AppError("Invalid or expired access token.", 401);
      }
    },
    async signOut(accessTokenValue: string): Promise<void> {
      await db
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(eq(authSessions.tokenHash, hash(accessTokenValue)));
      await audit("logout", { outcome: "success" });
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
