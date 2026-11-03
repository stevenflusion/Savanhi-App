import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { createDatabaseConnection } from "../database/connection.js";
import type { BackendEnv } from "../types/env.js";
import { customerDisplayName } from "./customer-name.js";

/**
 * The name a tendero sees beside a redemption (S3, S9, S11).
 *
 * The helper is one expression, and every one of these cases is a real state of
 * `users.full_name` rather than a hypothetical: an OTP-registered user carries
 * an empty name until the profile step, and the profile route takes whatever
 * the customer typed, padding included.
 */
test("the display name is the first name and nothing else", () => {
  // The ordinary case: the surname is withheld even though the row holds it.
  assert.equal(customerDisplayName("Ana María Pérez"), "Ana");

  // One token is a complete answer, not a degenerate one.
  assert.equal(customerDisplayName("Ana"), "Ana");

  // Padding and repeated separators are the customer's typing, not data.
  assert.equal(customerDisplayName("  Ana   Pérez  "), "Ana");
  assert.equal(customerDisplayName("\tAna\nPérez"), "Ana");

  // No name at all is NULL, never an empty string: the wording for the absence
  // belongs to the app that renders it, and an empty string would render as a
  // blank line instead.
  assert.equal(customerDisplayName(""), null);
  assert.equal(customerDisplayName("   "), null);
  assert.equal(customerDisplayName("\t\n "), null);
});

const env: BackendEnv = {
  serviceName: "customer-name-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "customer-name-tests",
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

/** Thrown to roll back the probe below; it is never a real failure. */
class Rollback extends Error {}

/** Every message on the cause chain, since drizzle wraps the `pg` error. */
function messageChain(error: unknown): string {
  const messages: string[] = [];
  let current = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" | ");
}

/**
 * `customerDisplayName` takes a `string` and not a `string | null`, and that
 * signature is only safe because the column cannot be null — `.trim()` on a
 * null would be a TypeError, which at the HTTP boundary is a 500 on the
 * redemption history.
 *
 * The invariant is therefore pinned here rather than assumed: the column is
 * `NOT NULL` in `schema.ts`, in migration `0000`, and in the database this
 * asserts against. If a future migration ever drops the constraint, this fails
 * and the helper's signature gets revisited instead of breaking at runtime.
 */
test("users.full_name cannot be null, which is what the signature rests on", async (t) => {
  const db = createDatabaseConnection(env);
  t.after(async () => {
    await db.pool.end();
  });

  const { rows } = await db.pool.query<{ is_nullable: string }>(
    `select is_nullable from information_schema.columns
       where table_schema = 'public'
         and table_name = 'users'
         and column_name = 'full_name'`,
  );
  assert.equal(rows.length, 1, "users.full_name is missing from the schema");
  assert.equal(rows[0]?.is_nullable, "NO");

  // And the constraint is LIVE, not merely declared. The probe runs inside a
  // transaction that is always rolled back, so a day on which the constraint is
  // gone leaves no user behind either — the assertion is what fails, not the
  // cleanup.
  let rejection: unknown;
  try {
    await db.transaction(async (tx) => {
      rejection = await tx
        .execute(
          sql`insert into users (role_id, email, email_normalized, full_name)
                values ((select id from roles limit 1), 'null-name-probe@example.test',
                        'null-name-probe@example.test', null)`,
        )
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  // Drizzle wraps the failed statement, so the `pg` error that carries the
  // message sits on the cause chain rather than on the thrown error.
  assert.match(messageChain(rejection), /null value in column "full_name"/);
});
