import type { CustomerClaim } from "@repo/api-contracts";

import type { AuthRemoteResult } from "@/src/features/auth";

/**
 * The customer claim endpoints. `claimCoupon` and `reissueQr` are the only
 * answers that carry a plaintext token; `listClaims` always has `qrToken: null`.
 */
export type WalletRemoteRepository = {
  claimCoupon: (
    accessToken: string,
    couponId: string,
  ) => Promise<AuthRemoteResult<CustomerClaim>>;
  /** Every claim of this customer, newest first, no pagination. */
  listClaims: (
    accessToken: string,
  ) => Promise<AuthRemoteResult<CustomerClaim[]>>;
  /** Issues a NEW token and kills the previous one at once. */
  reissueQr: (
    accessToken: string,
    claimId: string,
  ) => Promise<AuthRemoteResult<CustomerClaim>>;
};

/**
 * Who an operation belongs to. `isCurrent` turns false for good once the
 * provider that created the owner is gone (logout, a new user, a closed gate),
 * and an owner never becomes current again.
 */
export type QrOwner = { userId: string; isCurrent: () => boolean };

export type QrReadResult =
  | { status: "ok"; token: string }
  | { status: "missing" | "stale" | "error" };
export type QrWriteResult = "saved" | "stale" | "failed";

/** The device keystore for QR tokens, one entry per user and claim. */
export type QrTokenStore = {
  read: (owner: QrOwner, claimId: string) => Promise<QrReadResult>;
  write: (
    owner: QrOwner,
    claimId: string,
    token: string,
  ) => Promise<QrWriteResult>;
  /** Best effort; a stale owner or a failure leaves the entry alone. */
  remove: (owner: QrOwner, claimId: string) => Promise<void>;
};
