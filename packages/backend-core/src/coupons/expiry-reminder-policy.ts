import { createHash } from "node:crypto";

export type ExpiryReminderGroup = "reminder" | "holdout";

interface ClaimSnapshot {
  status: string;
  releasedOn: string | null;
  validTo: string;
}

/** The caller supplies tomorrow from the same database calendar as coupon validity. */
export function isExpiryReminderDue(claim: ClaimSnapshot, tomorrow: string): boolean {
  return claim.status === "claimed" && claim.releasedOn === null && claim.validTo === tomorrow;
}

/** Keep all eligible reservations by the same customer in the same pilot arm. */
export function expiryReminderGroupForCustomer(customerId: string): ExpiryReminderGroup {
  const digest = createHash("sha256").update(`coupon-expiry-reminder:v1:${customerId}`).digest();
  return (digest[0]! & 1) === 0 ? "reminder" : "holdout";
}

export function buildExpiryReminder(claimId: string) {
  return {
    title: "Tu cupón vence mañana",
    body: "Abre Savanhi para ver dónde canjearlo.",
    data: { type: "coupon-expiry-reminder" as const, claimId },
  };
}
