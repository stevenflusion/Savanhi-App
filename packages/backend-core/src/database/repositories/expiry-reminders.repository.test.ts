import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import {
  expiryReminderGroupForCustomer,
  type ExpiryReminderGroup,
} from "../../coupons/expiry-reminder-policy.js";
import { runExpiryReminderJob } from "../../coupons/expiry-reminder-worker.js";
import { createExpoExpiryPush } from "../../coupons/expo-expiry-push.js";
import { createDatabaseConnection } from "../connection.js";
import { createExpiryRemindersRepository } from "./expiry-reminders.repository.js";

const databaseUrl = process.env.PUSH_TEST_DATABASE_URL;
const skip = !databaseUrl && "Set PUSH_TEST_DATABASE_URL to a disposable, migrated local database";

type Session = "live" | "revoked" | "rotated" | "rotatedThenLive" | "expired" | "none";
interface Options {
  arm?: ExpiryReminderGroup;
  validToOffset?: number;
  status?: "claimed" | "redeemed";
  released?: boolean;
  active?: boolean;
  verified?: boolean;
  birthDate?: string | null;
  session?: Session;
  paused?: boolean;
}

function setup(t: TestContext) {
  assert.equal(new URL(databaseUrl!).hostname, "127.0.0.1");
  const db = createDatabaseConnection({ databaseUrl } as never);
  const repository = createExpiryRemindersRepository(db);
  const created = { users: [] as string[], stores: [] as string[] };
  const q = (text: string, values: unknown[] = []) => db.pool.query(text, values);
  t.after(async () => {
    await q("delete from stores where id = any($1::uuid[])", [created.stores]);
    await q("delete from users where id = any($1::uuid[])", [created.users]);
    await db.pool.end();
  });

  async function user(id: string, o: Options, roleName = "client") {
    await q("insert into roles (name) values ($1) on conflict (name) do nothing", [roleName]);
    await q(
      `insert into users (id, role_id, email, email_normalized, full_name, birth_date, active, email_verified_at)
       values ($1, (select id from roles where name = $2), $3, $3, 'Test', $4, $5, $6)`,
      [id, roleName, `${id}@example.test`, o.birthDate === undefined ? "1990-01-01" : o.birthDate,
        o.active ?? true, o.verified === false ? null : new Date()],
    );
    created.users.push(id);
  }
  async function session(userId: string, familyId: string, kind: Session) {
    const row = (flags: string, ageMinutes = -60) =>
      q(
        `insert into auth_sessions (user_id, token_hash, refresh_token_hash, family_id, expires_at, revoked_at, rotated_at)
         values ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval, ${flags})`,
        [userId, randomUUID(), randomUUID(), familyId, String(-ageMinutes)],
      );
    if (kind === "live") await row("null, null");
    if (kind === "revoked") await row("now(), null");
    if (kind === "rotated") await row("null, now()");
    if (kind === "expired") await row("null, null", 5);
    if (kind === "rotatedThenLive") (await row("null, now()"), await row("null, null"));
  }

  /** One reservation expiring `validToOffset` days from today (default tomorrow). */
  async function reservation(o: Options = {}) {
    let userId = randomUUID();
    while (o.arm && expiryReminderGroupForCustomer(userId) !== o.arm) userId = randomUUID();
    const ownerId = randomUUID();
    await user(userId, o);
    await user(ownerId, {}, "tendero");
    const [store] = (await q("insert into stores (owner_user_id, name) values ($1, 'Test') returning id", [ownerId])).rows;
    created.stores.push(store.id);
    const [coupon] = (await q(
      `insert into coupons (store_id, type, title, valid_from, valid_to, total_stock, paused)
       values ($1, 'combo', 'Test', ((now() at time zone 'America/Bogota')::date - 5), ((now() at time zone 'America/Bogota')::date + $2::int), 10, $3) returning id`,
      [store.id, o.validToOffset ?? 1, o.paused ?? false],
    )).rows;
    const redeemed = o.status === "redeemed";
    const [claim] = (await q(
      `insert into coupon_claims (coupon_id, customer_user_id, status, qr_token_hash, redeemed_on, redeemed_by_user_id, released_on)
       values ($1, $2, $3, $4, ${redeemed ? "(now() at time zone 'America/Bogota')::date" : "null"}, ${redeemed ? "$5" : "null::uuid"},
       ${o.released ? "(now() at time zone 'America/Bogota')::date" : "null"}) returning id`,
      redeemed ? [coupon.id, userId, o.status, randomUUID(), ownerId] : [coupon.id, userId, "claimed", randomUUID()],
    )).rows;
    const familyId = randomUUID();
    const kind = o.session ?? "live";
    await session(userId, familyId, kind);
    let deviceId: string | null = null;
    if (kind !== "none") {
      deviceId = (await q(
        "insert into customer_push_devices (user_id, family_id, expo_token) values ($1, $2, $3) returning id",
        [userId, familyId, `ExponentPushToken[${randomUUID()}]`],
      )).rows[0].id;
    }
    return { claimId: claim.id as string, userId, ownerId, familyId, deviceId, couponId: coupon.id as string };
  }
  const ledger = async (ids: string[]) =>
    (await q("select claim_id, arm, state from coupon_expiry_reminders where claim_id = any($1::uuid[])", [ids])).rows;
  return { db, repository, q, reservation, ledger };
}

test("assigns every due, eligible reservation once in both arms and skips each ineligible one", { skip }, async (t) => {
  const { repository, reservation, ledger, q } = setup(t);
  const eligible = [
    await reservation({ arm: "reminder" }),
    await reservation({ arm: "holdout" }),
    await reservation({ paused: true }), // a paused coupon stays redeemable, so it is still reminded
    await reservation({ session: "rotatedThenLive" }),
  ];
  const excluded = {
    // refresh reuse revokes the whole family but leaves the device row behind (T2 L9)
    revokedFamilyWithDeviceRow: await reservation({ session: "revoked" }),
    rotatedOnly: await reservation({ session: "rotated" }),
    expiredSession: await reservation({ session: "expired" }),
    noDevice: await reservation({ session: "none" }),
    inactive: await reservation({ active: false }),
    unverified: await reservation({ verified: false }),
    underage: await reservation({ birthDate: "2020-01-01" }),
    noBirthDate: await reservation({ birthDate: null }),
    expiresToday: await reservation({ validToOffset: 0 }),
    expiresInTwoDays: await reservation({ validToOffset: 2 }),
    released: await reservation({ released: true }),
    redeemed: await reservation({ status: "redeemed" }),
  };
  const [orphan] = (await q("select count(*)::int as n from customer_push_devices d where d.id = $1", [
    excluded.revokedFamilyWithDeviceRow.deviceId,
  ])).rows;
  assert.equal(orphan.n, 1, "the revoked family really keeps its device row");

  await repository.assignDue(1000);
  await repository.assignDue(1000);

  const rows = await ledger([...eligible, ...Object.values(excluded)].map((r) => r.claimId));
  assert.deepEqual(
    rows.map((row) => row.claim_id).sort(),
    eligible.map((r) => r.claimId).sort(),
    "assigned exactly the eligible reservations, once each",
  );
  for (const row of rows) {
    const owner = eligible.find((r) => r.claimId === row.claim_id)!;
    assert.equal(row.arm, expiryReminderGroupForCustomer(owner.userId));
    assert.equal(row.state, "assigned");
  }
  assert.deepEqual(new Set(rows.map((row) => row.arm)), new Set(["reminder", "holdout"]));
});

test("acquires each reminder exactly once under concurrent callers, never a holdout", { skip }, async (t) => {
  const { repository, reservation, ledger, q } = setup(t);
  const reminders = await Promise.all(Array.from({ length: 12 }, () => reservation({ arm: "reminder" })));
  const holdouts = await Promise.all(Array.from({ length: 3 }, () => reservation({ arm: "holdout" })));
  await repository.assignDue(1000);

  const seen: string[] = [];
  const mine = new Set(reminders.map((r) => r.claimId));
  const worker = async () => {
    for (;;) {
      const batch = await repository.acquire(2);
      if (batch.length === 0) return;
      seen.push(...batch.map((b) => b.claimId));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  const acquired = seen.filter((id) => mine.has(id));
  assert.equal(acquired.length, 12);
  assert.equal(new Set(acquired).size, 12, "no reservation is acquired twice");
  const rows = await ledger([...mine, ...holdouts.map((h) => h.claimId)]);
  assert.ok(rows.filter((row) => mine.has(row.claim_id)).every((row) => row.state === "sending"));
  assert.ok(rows.filter((row) => !mine.has(row.claim_id)).every((row) => row.state === "assigned"));
  assert.deepEqual(await repository.acquire(5), [], "an acquired row is never offered again");

  const [attempt] = (await q("select attempted_at, device_id from coupon_expiry_reminders where claim_id = $1", [reminders[0]!.claimId])).rows;
  assert.ok(attempt.attempted_at);
  assert.equal(attempt.device_id, reminders[0]!.deviceId);
});

test("a family revoked after acquisition fails the pre-send recheck, and a device is dropped only if identical", { skip }, async (t) => {
  const { repository, reservation, q } = setup(t);
  const a = await reservation({ arm: "reminder" });
  const b = await reservation({ arm: "reminder" });
  await repository.assignDue(1000);
  const acquired = await repository.acquire(1000);
  const first = acquired.find((r) => r.claimId === a.claimId)!;
  const second = acquired.find((r) => r.claimId === b.claimId)!;

  assert.equal(await repository.confirmDevice(first), true);
  await q("update auth_sessions set revoked_at = now() where family_id = $1", [a.familyId]);
  assert.equal(await repository.confirmDevice(first), false);
  await q("update coupon_claims set status = 'redeemed', redeemed_on = current_date, redeemed_by_user_id = $2 where id = $1", [b.claimId, a.userId]);
  assert.equal(await repository.confirmDevice(second), false, "a redeemed claim is no longer sent");

  // The token now belongs to another family/owner: the stale binding must survive.
  await q("update customer_push_devices set family_id = $2 where id = $1", [b.deviceId, randomUUID()]);
  assert.equal(await repository.dropDevice(second), false);
  await q("update customer_push_devices set expo_token = 'ExponentPushToken[new]' where id = $1", [a.deviceId]);
  assert.equal(await repository.dropDevice(first), false);
  const count = () => q("select count(*)::int as n from customer_push_devices where id = any($1::uuid[])", [[a.deviceId, b.deviceId]]);
  assert.equal((await count()).rows[0].n, 2);
  await q("update customer_push_devices set expo_token = $2 where id = $1", [a.deviceId, first.expoToken]);
  assert.equal(await repository.dropDevice(first), true);
  assert.equal((await count()).rows[0].n, 1);
});

test("a crashed attempt becomes unknown, never accepted, and the report counts both arms against assignment", { skip }, async (t) => {
  const { repository, reservation, q } = setup(t);
  const before = await repository.report();
  const today = "(now() at time zone 'America/Bogota')::date";
  const make = async (
    arm: ExpiryReminderGroup,
    state: string,
    o: { validTo?: number; redeemed?: number; fresh?: boolean } = {},
  ) => {
    const validTo = o.validTo ?? -1; // default: mature, expired yesterday
    const r = await reservation({ arm, validToOffset: validTo });
    if (o.redeemed !== undefined) {
      await q(
        `update coupon_claims set status = 'redeemed', redeemed_on = ${today} + $2::int, redeemed_by_user_id = $3 where id = $1`,
        [r.claimId, o.redeemed, r.ownerId],
      );
    }
    await q(
      `insert into coupon_expiry_reminders (claim_id, arm, state, assigned_on, attempted_at)
       values ($1, $2, $3, ${today} + $4::int, now() - ($5 || ' minutes')::interval)`,
      [r.claimId, arm, state, validTo - 1, o.fresh ? "0" : "60"],
    );
  };
  await make("reminder", "accepted", { redeemed: -1 }); // redeemed inside its own window
  await make("reminder", "sending"); // crashed job: stale
  await make("reminder", "sending", { fresh: true }); // genuinely in flight
  await make("reminder", "unknown");
  await make("reminder", "rejected");
  await make("holdout", "assigned", { redeemed: -1 });
  await make("holdout", "assigned", { redeemed: -4 }); // redeemed before its own window
  await make("holdout", "assigned", { validTo: 1 }); // not mature: counted nowhere

  assert.equal(await repository.expireStale(30), 1, "only the stale attempt is converted");
  const after = await repository.report();
  const diff = (arm: ExpiryReminderGroup) => {
    const a = after.find((row) => row.arm === arm)!;
    const b = before.find((row) => row.arm === arm)! as unknown as Record<string, unknown>;
    return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === "number" ? v - (b[k] as number) : v]));
  };
  assert.deepEqual(diff("reminder"), {
    arm: "reminder", assigned: 5, redeemedInWindow: 1, redeemedBeforeWindow: 0,
    accepted: 1, rejected: 1, unknown: 2, sending: 1, notAttempted: 0,
  });
  assert.deepEqual(diff("holdout"), {
    arm: "holdout", assigned: 2, redeemedInWindow: 1, redeemedBeforeWindow: 1,
    accepted: 0, rejected: 0, unknown: 0, sending: 0, notAttempted: 2,
  });
});

test("overlapping worker runs call the provider once per claim and keep accepted separate from delivery", { skip }, async (t) => {
  const { repository, reservation, ledger } = setup(t);
  const reminders = await Promise.all(Array.from({ length: 5 }, () => reservation({ arm: "reminder" })));
  const holdout = await reservation({ arm: "holdout" });
  const sent: { url: string; body: { to: string; data: { claimId: string } } }[] = [];
  const push = createExpoExpiryPush({
    timeoutMs: 1000,
    fetch: async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(String(init!.body)) });
      await sleep(15);
      return new Response(JSON.stringify({ data: { status: "ok", id: "ticket" } }));
    },
  });
  const run = () => runExpiryReminderJob({ store: repository, push, enabled: true, batchSize: 2, maxSends: 50 });
  await Promise.all([run(), run(), run()]);
  await run();

  const ids = new Set(reminders.map((r) => r.claimId));
  const mine = sent.filter((s) => ids.has(s.body.data.claimId));
  assert.equal(mine.length, 5);
  assert.equal(new Set(mine.map((s) => s.body.data.claimId)).size, 5);
  assert.ok(sent.every((s) => s.url === "https://exp.host/--/api/v2/push/send"));
  assert.ok(!sent.some((s) => s.body.data.claimId === holdout.claimId));
  const states = await ledger([...ids, holdout.claimId]);
  assert.equal(states.filter((s) => s.state === "accepted").length, 5);
  assert.equal(states.find((s) => s.claim_id === holdout.claimId)!.state, "assigned");
});
