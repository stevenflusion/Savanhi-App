/**
 * One-shot coupon expiry reminder job, meant for an external scheduler.
 *
 *   node dist/scripts/coupon-expiry-reminders.js run     sends (opt-in, see below)
 *   node dist/scripts/coupon-expiry-reminders.js report  read-only pilot counts
 *
 * Exactly one argument is accepted; there are no flags (no dry-run mode).
 *
 * Reads DATABASE_URL from the process environment only: unlike the server it
 * does not load .env files, so a scheduler (or a test) always names its target.
 * `run` sends nothing unless COUPON_EXPIRY_REMINDERS_SEND is exactly "true";
 * `report` never sends and never writes. Output is counts only, never tokens.
 */
import { createDatabaseConnection } from "../database/connection.js";
import { createExpiryRemindersRepository } from "../database/repositories/expiry-reminders.repository.js";
import { runExpiryReminderJob } from "../coupons/expiry-reminder-worker.js";
import { createExpoExpiryPush } from "../coupons/expo-expiry-push.js";

const command = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
// Strict syntax: exactly one command and nothing after it, so a flag such as
// `--dry-run` can never be mistaken for a mode this job does not have.
if (process.argv.length !== 3 || (command !== "run" && command !== "report") || !databaseUrl) {
  console.error("Usage: DATABASE_URL=... coupon-expiry-reminders <run|report>");
  process.exit(2);
}

const db = createDatabaseConnection({ databaseUrl } as never);
try {
  const store = createExpiryRemindersRepository(db);
  if (command === "report") {
    console.log(JSON.stringify(await store.report(), null, 2));
  } else {
    const enabled = process.env.COUPON_EXPIRY_REMINDERS_SEND === "true";
    const summary = await runExpiryReminderJob({ store, push: createExpoExpiryPush(), enabled });
    console.log(JSON.stringify({ sendEnabled: enabled, ...summary }));
  }
} finally {
  await db.pool.end();
}
