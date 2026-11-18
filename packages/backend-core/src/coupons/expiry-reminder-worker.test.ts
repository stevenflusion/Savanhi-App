import assert from "node:assert/strict";
import { test } from "node:test";
import type { AcquiredReminder } from "../database/repositories/expiry-reminders.repository.js";
import { runExpiryReminderJob, type ExpiryReminderStore } from "./expiry-reminder-worker.js";
import type { PushOutcome } from "./expo-expiry-push.js";

const reminder = (n: number): AcquiredReminder => ({
  claimId: `claim-${n}`,
  userId: `user-${n}`,
  deviceId: `device-${n}`,
  familyId: `family-${n}`,
  expoToken: `ExponentPushToken[${n}]`,
  expiresAtEpoch: 1_800_000_000,
});

function harness(options: {
  queue: AcquiredReminder[];
  outcomes?: Record<string, PushOutcome | Error>;
  stillEligible?: (r: AcquiredReminder) => boolean;
  enabled?: boolean;
  maxSends?: number;
}) {
  const log: string[] = [];
  const queue = [...options.queue];
  const store: ExpiryReminderStore = {
    expireStale: async () => (log.push("expireStale"), 0),
    assignDue: async () => (log.push("assignDue"), 0),
    acquire: async (limit) => (log.push(`acquire:${limit}`), queue.splice(0, limit)),
    confirmDevice: async (r) => (log.push(`confirm:${r.claimId}`), options.stillEligible?.(r) ?? true),
    finish: async (id, state) => void log.push(`finish:${id}:${state}`),
    dropDevice: async (r) => (log.push(`drop:${r.deviceId}:${r.expoToken}`), true),
  };
  const push = {
    send: async (m: { to: string; message: { data: { claimId: string } } }) => {
      log.push(`send:${m.message.data.claimId}`);
      const outcome = options.outcomes?.[m.message.data.claimId] ?? "accepted";
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  const run = () =>
    runExpiryReminderJob({
      store,
      push,
      enabled: options.enabled ?? true,
      batchSize: 2,
      maxSends: options.maxSends ?? 10,
    });
  return { run, log };
}

test("does nothing, not even assignment, unless sending is explicitly enabled", async () => {
  const { run, log } = harness({ queue: [reminder(1)], enabled: false });
  assert.deepEqual(await run(), { assigned: 0, accepted: 0, rejected: 0, unknown: 0, skipped: 0 });
  assert.deepEqual(log, []);
});

test("rechecks right before each send and skips, without a request, a lapsed one", async () => {
  const { run, log } = harness({
    queue: [reminder(1), reminder(2)],
    stillEligible: (r) => r.claimId !== "claim-1",
  });
  const result = await run();
  assert.equal(result.skipped, 1);
  assert.equal(result.accepted, 1);
  assert.ok(log.includes("finish:claim-1:skipped"));
  assert.ok(!log.includes("send:claim-1"));
  assert.ok(log.indexOf("confirm:claim-2") < log.indexOf("send:claim-2"));
});

test("records each outcome once, never retries and keeps going after a failure", async () => {
  const { run, log } = harness({
    queue: [reminder(1), reminder(2), reminder(3)],
    outcomes: { "claim-1": "unknown", "claim-2": new Error("boom: secret detail"), "claim-3": "rejected" },
  });
  const result = await run();
  assert.deepEqual(result, { assigned: 0, accepted: 0, rejected: 1, unknown: 2, skipped: 0 });
  assert.equal(log.filter((entry) => entry.startsWith("send:")).length, 3);
  assert.ok(log.includes("finish:claim-1:unknown"));
  assert.ok(log.includes("finish:claim-2:unknown"));
  assert.ok(log.includes("finish:claim-3:rejected"));
});

test("drops a device only for DeviceNotRegistered, naming exactly the row that was sent to", async () => {
  const { run, log } = harness({
    queue: [reminder(1), reminder(2)],
    outcomes: { "claim-1": "device_not_registered", "claim-2": "rejected" },
  });
  await run();
  assert.deepEqual(log.filter((entry) => entry.startsWith("drop:")), [
    "drop:device-1:ExponentPushToken[1]",
  ]);
  assert.ok(log.includes("finish:claim-1:rejected"));
});

test("a run is bounded by maxSends", async () => {
  const { run, log } = harness({
    queue: [reminder(1), reminder(2), reminder(3), reminder(4), reminder(5)],
    maxSends: 3,
  });
  assert.equal((await run()).accepted, 3);
  assert.equal(log.filter((entry) => entry.startsWith("send:")).length, 3);
  assert.equal(log.filter((entry) => entry.startsWith("acquire:")).at(-1), "acquire:1");
});
