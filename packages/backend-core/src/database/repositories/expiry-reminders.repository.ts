import { CUSTOMER_MINIMUM_AGE } from "@repo/api-contracts/auth";
import { and, eq, sql } from "drizzle-orm";
import {
  expiryReminderGroupForCustomer,
  isExpiryReminderDue,
  type ExpiryReminderGroup,
} from "../../coupons/expiry-reminder-policy.js";
import { COUPON_CALENDAR_TIMEZONE, couponCalendarToday } from "../calendar.js";
import type { DatabaseConnection } from "../connection.js";
import {
  couponClaims,
  couponExpiryReminders,
  coupons,
  customerPushDevices,
} from "../schema.js";

export interface AcquiredReminder {
  claimId: string;
  userId: string;
  deviceId: string;
  familyId: string;
  expoToken: string;
  /** End of the coupon's last day in the coupon calendar, as unix seconds. */
  expiresAtEpoch: number;
}

export interface ExpiryReminderReportRow {
  arm: ExpiryReminderGroup;
  /** Mature reservations assigned to the arm: the denominator of every rate. */
  assigned: number;
  redeemedInWindow: number;
  /** Redeemed before the day the reservation was assigned; a data-quality guard. */
  redeemedBeforeWindow: number;
  /** Provider accepted a ticket. NOT a delivery count. */
  accepted: number;
  rejected: number;
  /** Outcome not observed: timeouts, 5xx and attempts that crashed mid-flight. */
  unknown: number;
  sending: number;
  notAttempted: number;
}

/**
 * Reminders live-eligible RIGHT NOW, one row per reservation with its single
 * chosen device. It is the one definition of "may be reminded": every statement
 * that assigns, acquires or rechecks embeds it, so they cannot disagree.
 *
 * The reservation must be unreleased and still `claimed`, expiring tomorrow in
 * the coupon calendar. A paused coupon and a deactivated store are NOT checked,
 * because redemption does not check them either (a claim stays redeemable up to
 * its validity end), so the reminder stays consistent with what the person can
 * still do. The customer must be what `requireEligibleClient` demands (active,
 * verified, 18+) and the device must sit on a LIVE session family of the same
 * user: refresh-token reuse revokes a family but leaves its device row (T2 L11).
 * The newest-registered device wins, ties broken by id, so the choice is stable.
 */
function eligibleReservations() {
  const today = couponCalendarToday();
  const timezone = sql.raw(`'${COUPON_CALENDAR_TIMEZONE}'`);
  return sql`
    select cc.id as claim_id, cc.customer_user_id as user_id, dev.id as device_id,
      dev.family_id, dev.expo_token,
      extract(epoch from ((cp.valid_to + 1)::timestamp at time zone ${timezone}))::bigint as expires_at_epoch
    from coupon_claims cc
    join coupons cp on cp.id = cc.coupon_id
    join users u on u.id = cc.customer_user_id
    join roles ro on ro.id = u.role_id
    join lateral (
      select d.id, d.family_id, d.expo_token
      from customer_push_devices d
      where d.user_id = cc.customer_user_id
        and exists (
          select 1 from auth_sessions s
          where s.user_id = d.user_id and s.family_id = d.family_id
            and s.revoked_at is null and s.rotated_at is null and s.expires_at > now()
        )
      order by d.updated_at desc, d.id
      limit 1
    ) dev on true
    where cc.status = 'claimed' and cc.released_on is null
      and cp.valid_to = ${today} + 1
      and ro.name = 'client' and u.active and u.email_verified_at is not null
      and u.birth_date <= (${today} - make_interval(years => ${sql.raw(String(CUSTOMER_MINIMUM_AGE))}))`;
}

type Row = Record<string, unknown>;

export function createExpiryRemindersRepository(db: DatabaseConnection) {
  const rows = async (statement: ReturnType<typeof sql>) =>
    (await db.execute(statement)).rows as Row[];

  return {
    /**
     * Writes the pilot assignment for due reservations that have none yet, in
     * both arms. The arm is the stable customer-level hash of T1. Idempotent:
     * the primary key makes a concurrent or repeated call a no-op.
     */
    async assignDue(limit: number): Promise<number> {
      const due = await rows(sql`
        select e.claim_id, e.user_id, to_char(${couponCalendarToday()}, 'YYYY-MM-DD') as today
        from (${eligibleReservations()}) e
        where not exists (select 1 from coupon_expiry_reminders r where r.claim_id = e.claim_id)
        order by e.claim_id
        limit ${limit}`);
      if (due.length === 0) return 0;
      const inserted = await db
        .insert(couponExpiryReminders)
        .values(
          due.map((row) => ({
            claimId: row.claim_id as string,
            arm: expiryReminderGroupForCustomer(row.user_id as string),
            assignedOn: row.today as string,
          })),
        )
        .onConflictDoNothing()
        .returning({ claimId: couponExpiryReminders.claimId });
      return inserted.length;
    },

    /**
     * Atomically moves up to `limit` reminder-arm rows to `sending`, in ONE
     * statement that rechecks live eligibility and records the chosen device.
     * `skip locked` lets overlapping runs take disjoint rows without waiting,
     * and oldest-first order means a row is never starved by newer ones. No
     * lock outlives the statement, so none is held across the provider call.
     */
    async acquire(limit: number): Promise<AcquiredReminder[]> {
      const acquired = await rows(sql`
        with picked as (
          select e.claim_id, e.user_id, e.device_id, e.family_id, e.expo_token, e.expires_at_epoch
          from coupon_expiry_reminders r
          join (${eligibleReservations()}) e on e.claim_id = r.claim_id
          where r.arm = 'reminder' and r.state = 'assigned'
          order by r.created_at, r.claim_id
          limit ${limit}
          for update of r skip locked
        )
        update coupon_expiry_reminders r
        set state = 'sending', attempted_at = now(), device_id = picked.device_id
        from picked
        where r.claim_id = picked.claim_id and r.state = 'assigned'
        returning picked.claim_id, picked.user_id, picked.device_id, picked.family_id,
          picked.expo_token, picked.expires_at_epoch`);
      return acquired.map((row) => ({
        claimId: row.claim_id as string,
        userId: row.user_id as string,
        deviceId: row.device_id as string,
        familyId: row.family_id as string,
        expoToken: row.expo_token as string,
        expiresAtEpoch: Number(row.expires_at_epoch),
      }));
    },

    /** Just before the request: still due, and still reachable on the SAME device. */
    async confirmDevice(reminder: AcquiredReminder): Promise<boolean> {
      const [claim] = await db
        .select({
          status: couponClaims.status,
          releasedOn: couponClaims.releasedOn,
          validTo: coupons.validTo,
          tomorrow: sql<string>`to_char(${couponCalendarToday()} + 1, 'YYYY-MM-DD')`,
        })
        .from(couponClaims)
        .innerJoin(coupons, eq(coupons.id, couponClaims.couponId))
        .where(eq(couponClaims.id, reminder.claimId));
      if (!claim || !isExpiryReminderDue(claim, claim.tomorrow)) return false;
      const live = await rows(sql`
        select 1 from (${eligibleReservations()}) e
        where e.claim_id = ${reminder.claimId} and e.device_id = ${reminder.deviceId}
          and e.expo_token = ${reminder.expoToken} and e.family_id = ${reminder.familyId}`);
      return live.length === 1;
    },

    /** Records the outcome of an attempt; a row that is not `sending` is left alone. */
    async finish(claimId: string, state: "accepted" | "rejected" | "unknown" | "skipped") {
      await db
        .update(couponExpiryReminders)
        .set({ state, completedAt: new Date() })
        .where(and(eq(couponExpiryReminders.claimId, claimId), eq(couponExpiryReminders.state, "sending")));
    },

    /**
     * An attempt with no recorded result after `olderThanMinutes` is a crashed
     * job: it becomes `unknown` so it can never be read as sent, and is never
     * retried. A merely slow job that finishes later finds the row no longer
     * `sending` and leaves `unknown` as is: the conservative side.
     */
    async expireStale(olderThanMinutes: number): Promise<number> {
      const expired = await db
        .update(couponExpiryReminders)
        .set({ state: "unknown", completedAt: new Date() })
        .where(
          and(
            eq(couponExpiryReminders.state, "sending"),
            sql`${couponExpiryReminders.attemptedAt} < now() - make_interval(mins => ${olderThanMinutes})`,
          ),
        )
        .returning({ claimId: couponExpiryReminders.claimId });
      return expired.length;
    },

    /**
     * Deletes the device row only if it is still EXACTLY the one the provider
     * rejected (same id, owner, session family and token). A token that moved
     * to a new owner or family is a different registration and is kept.
     */
    async dropDevice(reminder: AcquiredReminder): Promise<boolean> {
      const dropped = await db
        .delete(customerPushDevices)
        .where(
          and(
            eq(customerPushDevices.id, reminder.deviceId),
            eq(customerPushDevices.userId, reminder.userId),
            eq(customerPushDevices.familyId, reminder.familyId),
            eq(customerPushDevices.expoToken, reminder.expoToken),
          ),
        )
        .returning({ id: customerPushDevices.id });
      return dropped.length === 1;
    },

    /**
     * Read-only pilot counts per arm over MATURE reservations (validity ended
     * before today), from the saved assignment. The window of a reservation is
     * assignment day to validity end. Both arms always appear.
     */
    async report(): Promise<ExpiryReminderReportRow[]> {
      const counted = await rows(sql`
        select r.arm,
          count(*)::int as assigned,
          (count(*) filter (where cc.status = 'redeemed' and cc.redeemed_on between r.assigned_on and cp.valid_to))::int as redeemed_in_window,
          (count(*) filter (where cc.status = 'redeemed' and cc.redeemed_on < r.assigned_on))::int as redeemed_before_window,
          (count(*) filter (where r.state = 'accepted'))::int as accepted,
          (count(*) filter (where r.state = 'rejected'))::int as rejected,
          (count(*) filter (where r.state = 'unknown'))::int as unknown,
          (count(*) filter (where r.state = 'sending'))::int as sending,
          (count(*) filter (where r.state in ('assigned', 'skipped')))::int as not_attempted
        from coupon_expiry_reminders r
        join coupon_claims cc on cc.id = r.claim_id
        join coupons cp on cp.id = cc.coupon_id
        where cp.valid_to < ${couponCalendarToday()}
        group by r.arm`);
      return (["reminder", "holdout"] as const).map((arm) => {
        const row = counted.find((candidate) => candidate.arm === arm);
        const n = (key: string) => Number(row?.[key] ?? 0);
        return {
          arm,
          assigned: n("assigned"),
          redeemedInWindow: n("redeemed_in_window"),
          redeemedBeforeWindow: n("redeemed_before_window"),
          accepted: n("accepted"),
          rejected: n("rejected"),
          unknown: n("unknown"),
          sending: n("sending"),
          notAttempted: n("not_attempted"),
        };
      });
    },
  };
}
