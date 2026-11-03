import { sql, type SQL } from "drizzle-orm";

/**
 * The ONE timezone the coupon calendar is evaluated in.
 *
 * Coupon validity is date-granular (S6/S11), so “is this coupon valid today?”
 * needs a calendar day, and a calendar day needs a zone. Nothing in this
 * repository defined one before this task: Postgres runs in UTC, so
 * `current_date` is the UTC day and between 19:00 and 24:00 local time it is
 * already TOMORROW — a coupon would stop being claimable five hours early on
 * its last day, and a claim made at night would be stamped with the next day's
 * date.
 *
 * `America/Bogota` is the zone the product operates in, and it has no daylight
 * saving transition, so the offset never moves. Every validity comparison, the
 * derived `expired` status and the stored `claimed_on`/`redeemed_on` display
 * dates go through `couponCalendarToday()`, so they can never disagree.
 */
export const COUPON_CALENDAR_TIMEZONE = "America/Bogota";

/**
 * Today's date in `COUPON_CALENDAR_TIMEZONE`, as a SQL `date`. Built from the
 * constant rather than inlined, so the zone cannot drift between call sites.
 *
 * A fresh value per call, because a SQL fragment is embedded into whichever
 * statement asks for it.
 */
export function couponCalendarToday(): SQL<string> {
  return sql.raw(
    `(now() at time zone '${COUPON_CALENDAR_TIMEZONE}')::date`,
  ) as SQL<string>;
}
