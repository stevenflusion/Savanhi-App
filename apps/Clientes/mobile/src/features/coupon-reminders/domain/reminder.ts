/** The only notification type this app opens (set by the backend job). */
export const COUPON_REMINDER_TYPE = "coupon-expiry-reminder";

const CLAIM_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A notification response reduced to what the intake reads; no native type leaks. */
export type ReminderTap = {
  /** The notification identifier, used only to ignore a replayed response. */
  id: string;
  isDefaultAction: boolean;
  data: unknown;
};

/**
 * The claim a tap points at, or `null` for anything else: another type, another
 * action, or a claim id that is not an id. The id is only a lookup key into the
 * authenticated wallet; nothing else in the payload is read.
 */
export function parseReminderTap(tap: ReminderTap): string | null {
  if (!tap.isDefaultAction) return null;
  const { data } = tap;
  if (typeof data !== "object" || data === null) return null;
  const { type, claimId } = data as Record<string, unknown>;
  if (type !== COUPON_REMINDER_TYPE) return null;
  return typeof claimId === "string" && CLAIM_ID.test(claimId) ? claimId : null;
}
