import type { AcquiredReminder } from "../database/repositories/expiry-reminders.repository.js";
import { buildExpiryReminder } from "./expiry-reminder-policy.js";
import type { ExpiryPushInput, PushOutcome } from "./expo-expiry-push.js";

/** The slice of the repository the job needs, so it can be driven by a fake. */
export interface ExpiryReminderStore {
  expireStale(olderThanMinutes: number): Promise<number>;
  assignDue(limit: number): Promise<number>;
  acquire(limit: number): Promise<AcquiredReminder[]>;
  confirmDevice(reminder: AcquiredReminder): Promise<boolean>;
  finish(claimId: string, state: "accepted" | "rejected" | "unknown" | "skipped"): Promise<void>;
  dropDevice(reminder: AcquiredReminder): Promise<boolean>;
}

export interface ExpiryReminderJobSummary {
  assigned: number;
  accepted: number;
  rejected: number;
  unknown: number;
  skipped: number;
}

/** An attempt older than this with no recorded result is a crashed job. */
const STALE_ATTEMPT_MINUTES = 15;

/**
 * One bounded pass of the expiry reminder (S1). An external scheduler runs it;
 * there is no timer here.
 *
 * Per reservation: acquire (atomic, in the database, rechecking eligibility),
 * recheck once more, call the provider ONCE, record the outcome. No database
 * lock is held across the provider call, so a small window remains in which a
 * reservation can be redeemed or its session revoked after the last check; the
 * message is generic and the app rechecks the wallet, so that is accepted.
 * The acquisition is never rolled back after a request and a failed or unknown
 * attempt is never retried: sending twice is worse than missing one reminder.
 */
export async function runExpiryReminderJob({
  store,
  push,
  enabled,
  batchSize = 50,
  maxSends = 500,
}: {
  store: ExpiryReminderStore;
  push: { send(input: ExpiryPushInput): Promise<PushOutcome> };
  enabled: boolean;
  batchSize?: number;
  maxSends?: number;
}): Promise<ExpiryReminderJobSummary> {
  const summary = { assigned: 0, accepted: 0, rejected: 0, unknown: 0, skipped: 0 };
  if (!enabled) return summary;

  await store.expireStale(STALE_ATTEMPT_MINUTES);
  let assigned: number;
  do {
    assigned = await store.assignDue(batchSize);
    summary.assigned += assigned;
  } while (assigned === batchSize);

  let attempts = 0;
  while (attempts < maxSends) {
    const batch = await store.acquire(Math.min(batchSize, maxSends - attempts));
    if (batch.length === 0) break;
    attempts += batch.length;
    for (const reminder of batch) {
      if (!(await store.confirmDevice(reminder))) {
        summary.skipped++;
        await store.finish(reminder.claimId, "skipped");
        continue;
      }
      let outcome: PushOutcome;
      try {
        outcome = await push.send({
          to: reminder.expoToken,
          message: buildExpiryReminder(reminder.claimId),
          expiresAtEpoch: reminder.expiresAtEpoch,
        });
      } catch {
        outcome = "unknown";
      }
      const state = outcome === "accepted" ? "accepted" : outcome === "unknown" ? "unknown" : "rejected";
      summary[state]++;
      await store.finish(reminder.claimId, state);
      // Only the exact row we sent to, and only on a definite answer.
      if (outcome === "device_not_registered") await store.dropDevice(reminder);
    }
  }
  return summary;
}
