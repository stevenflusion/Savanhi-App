import { createContext, useContext } from "react";
import type { CustomerClaim } from "@repo/api-contracts";

export type QrResult =
  | { status: "ok"; token: string }
  /** The claim can no longer show a code (redeemed, released or expired). */
  | { status: "unavailable" }
  | { status: "failed" }
  /** The owner is gone or the session changed: nothing may be shown. */
  | { status: "ignored" };

export type ReleaseResult =
  /** The server confirmed the return. */
  | "released"
  /** The claim is no longer available (redeemed, released or expired). */
  | "unavailable"
  | "failed"
  /** The owner is gone or the session changed: nothing may be shown. */
  | "ignored";

export type WalletShared = {
  /** `null` until the first read answers; kept while a later read fails. */
  claims: CustomerClaim[] | null;
  claimsStatus: "idle" | "loading" | "error";
  loadClaims: () => Promise<void>;
  /** Coupons this customer took in this session; wins over any older feed read. */
  claimedCoupons: ReadonlySet<string>;
  pendingCoupons: readonly string[];
  claimError: boolean;
  claimCoupon: (couponId: string) => Promise<void>;
  /** The stored token, or one explicit re-issue when none is stored. */
  resolveQr: (claimId: string) => Promise<QrResult>;
  /** The one release path: one request per claim, coalesced. */
  releaseClaim: (claimId: string) => Promise<ReleaseResult>;
  /** Claims whose return is on its way: no second return and no QR for them. */
  releasingClaims: readonly string[];
};

export const WalletContext = createContext<WalletShared | null>(null);

/** `null` when no wallet is mounted above: Inicio then offers no claim action. */
export const useOptionalWallet = () => useContext(WalletContext);

export function useWallet(): WalletShared {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet must be used within WalletProvider");
  return wallet;
}
