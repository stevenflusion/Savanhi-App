import type { CustomerClaim, CustomerClaimStatus } from "@repo/api-contracts";

const STATUSES: readonly string[] = [
  "claimed",
  "redeemed",
  "expired",
  "released",
];

/**
 * The QR token is 43 base64url characters today; the check allows a margin but
 * never anything outside the base64url alphabet, so the value that reaches the
 * keystore and the encoder is always plain ASCII with no URL syntax.
 */
export const isQrToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isNullable = (value: unknown, type: "string" | "number") =>
  value === null || typeof value === type;

/** Strictly the shape the API promises; nothing is invented to fill a gap. */
export function isCustomerClaim(value: unknown): value is CustomerClaim {
  if (!isRecord(value)) return false;
  const { coupon, store } = value;
  return (
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    STATUSES.includes(value.status) &&
    isNullable(value.qrToken, "string") &&
    typeof value.claimedOn === "string" &&
    isNullable(value.redeemedOn, "string") &&
    isRecord(coupon) &&
    typeof coupon.id === "string" &&
    typeof coupon.title === "string" &&
    isNullable(coupon.description, "string") &&
    isNullable(coupon.freeText, "string") &&
    isNullable(coupon.percentageValue, "number") &&
    isNullable(coupon.fixedAmountValue, "number") &&
    typeof coupon.validFrom === "string" &&
    typeof coupon.validTo === "string" &&
    isRecord(store) &&
    typeof store.id === "string" &&
    typeof store.name === "string"
  );
}

/** A wallet record never carries the secret: it travels only to the keystore. */
export function withoutSecret(claim: CustomerClaim): CustomerClaim {
  return { ...claim, qrToken: null };
}

export const canShowQr = (status: CustomerClaimStatus) => status === "claimed";
