import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CustomerClaim } from "@repo/api-contracts";

import { useAuth } from "@/src/features/auth";
import { useDiscoveryShared } from "@/src/features/discovery/presentation/DiscoveryProvider";

import type {
  QrOwner,
  QrTokenStore,
  WalletRemoteRepository,
} from "../application/ports";
import { isQrToken } from "../domain/claim";
import { createQrTokenStore } from "../infrastructure/qr-secure-store";
import { createWalletFetchRepository } from "../infrastructure/wallet-fetch-repository";
import {
  WalletContext,
  type QrResult,
  type WalletShared,
} from "./wallet-context";

const defaultRepository = createWalletFetchRepository();
const defaultQrStore = createQrTokenStore();

const IGNORED: QrResult = { status: "ignored" };

type Props = {
  repository?: WalletRemoteRepository;
  qrStore?: QrTokenStore;
  children: ReactNode;
};

/**
 * Billetera and the claim action share one place, because both tabs stay
 * mounted once opened. Everything lives in memory except the QR tokens, which
 * go to the keystore the moment the server issues them.
 *
 * Every piece of work captures an OWNER first: an object that is current only
 * while this provider is mounted and never becomes current again. Closing the
 * gate (logout, a new user, a refused profile) unmounts the provider, so a late
 * answer can neither publish state nor reach the keystore.
 */
function SharedState({
  repository = defaultRepository,
  qrStore = defaultQrStore,
  children,
}: Props) {
  const { runProtected, user } = useAuth();
  const { refreshFeed } = useDiscoveryShared();
  const userId = user?.id ?? "";

  const runProtectedRef = useRef(runProtected);
  runProtectedRef.current = runProtected;
  const refreshFeedRef = useRef(refreshFeed);
  refreshFeedRef.current = refreshFeed;

  // A new object per mount (and per effect run), ended for good on cleanup: an
  // owner that has ended can never become current again, not even by a remount.
  const generation = useRef<{ ended: boolean } | null>(null);
  useEffect(() => {
    const current = { ended: false };
    generation.current = current;
    return () => {
      current.ended = true;
    };
  }, []);

  const currentOwner = useCallback((): QrOwner | null => {
    const captured = generation.current;
    if (!captured || captured.ended) return null;
    return { userId, isCurrent: () => !captured.ended };
  }, [userId]);

  // ---- the wallet, as the server reports it ------------------------------------
  const [claims, setClaims] = useState<CustomerClaim[] | null>(null);
  const [claimsStatus, setClaimsStatus] =
    useState<WalletShared["claimsStatus"]>("idle");
  const readSequence = useRef(0);

  const loadClaims = useCallback(async () => {
    const owner = currentOwner();
    if (!owner) return;
    const sequence = ++readSequence.current;
    setClaimsStatus("loading");

    const outcome = await runProtectedRef.current((token) =>
      repository.listClaims(token),
    );
    if (
      !owner.isCurrent() ||
      sequence !== readSequence.current ||
      outcome.status === "ignored"
    ) {
      return;
    }
    if (outcome.status === "failed") {
      setClaimsStatus("error");
      return;
    }
    setClaims(outcome.data);
    setClaimsStatus("idle");
    // A claim the server no longer calls available has no use for its token.
    for (const claim of outcome.data) {
      if (claim.status !== "claimed") void qrStore.remove(owner, claim.id);
    }
  }, [currentOwner, repository, qrStore]);

  // ---- claiming: the one mutation path --------------------------------------------
  const [claimedCoupons, setClaimedCoupons] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingCoupons, setPendingCoupons] = useState<string[]>([]);
  const [claimError, setClaimError] = useState(false);
  const pending = useRef(new Set<string>());

  const claimCoupon = useCallback(
    async (couponId: string) => {
      const owner = currentOwner();
      // One action per coupon at a time: a second tap is the same intent.
      if (!owner || pending.current.has(couponId)) return;
      pending.current.add(couponId);
      setPendingCoupons([...pending.current]);
      setClaimError(false);

      try {
        const outcome = await runProtectedRef.current((token) =>
          repository.claimCoupon(token, couponId),
        );
        if (!owner.isCurrent() || outcome.status === "ignored") return;
        if (outcome.status === "failed") {
          // Nothing says the server did NOT commit: read the feed again instead
          // of guessing, and never repeat the request on our own.
          setClaimError(true);
          refreshFeedRef.current();
          return;
        }

        // The server confirmed. The token is stored before anything is shown;
        // a failed or stale write is not a failed claim, because the claim is
        // real and «Ver QR» can issue a fresh code later.
        const { id, qrToken } = outcome.data;
        if (isQrToken(qrToken)) await qrStore.write(owner, id, qrToken);
        if (!owner.isCurrent()) return;

        setClaimedCoupons((current) => new Set(current).add(couponId));
        refreshFeedRef.current();
      } finally {
        pending.current.delete(couponId);
        setPendingCoupons([...pending.current]);
      }
    },
    [currentOwner, repository, qrStore],
  );

  // ---- the code of one claim -------------------------------------------------------
  const inFlight = useRef(new Map<string, Promise<QrResult>>());

  const resolveQr = useCallback(
    (claimId: string): Promise<QrResult> => {
      const running = inFlight.current.get(claimId);
      if (running) return running;
      const owner = currentOwner();
      if (!owner) return Promise.resolve(IGNORED);

      const work = (async (): Promise<QrResult> => {
        const stored = await qrStore.read(owner, claimId);
        if (stored.status === "stale" || !owner.isCurrent()) return IGNORED;
        if (stored.status === "ok") return { status: "ok", token: stored.token };
        // An unreadable keystore is not an absent token: never re-issue on a guess.
        if (stored.status === "error") return { status: "failed" };

        // No local token: ONE explicit re-issue, which kills the previous code.
        const outcome = await runProtectedRef.current((token) =>
          repository.reissueQr(token, claimId),
        );
        if (!owner.isCurrent() || outcome.status === "ignored") return IGNORED;
        if (outcome.status === "failed") {
          return outcome.httpStatus === 409
            ? { status: "unavailable" }
            : { status: "failed" };
        }
        const token = outcome.data.qrToken;
        if (!isQrToken(token)) return { status: "failed" };

        // Shown from memory even if the write fails; the owner decides it.
        await qrStore.write(owner, claimId, token);
        if (!owner.isCurrent()) return IGNORED;
        return { status: "ok", token };
      })().finally(() => {
        inFlight.current.delete(claimId);
      });
      inFlight.current.set(claimId, work);
      return work;
    },
    [currentOwner, repository, qrStore],
  );

  const value = useMemo<WalletShared>(
    () => ({
      claims,
      claimsStatus,
      loadClaims,
      claimedCoupons,
      pendingCoupons,
      claimError,
      claimCoupon,
      resolveQr,
    }),
    [
      claims,
      claimsStatus,
      loadClaims,
      claimedCoupons,
      pendingCoupons,
      claimError,
      claimCoupon,
      resolveQr,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

/** Keyed by customer, so a different login never inherits another's wallet. */
export function WalletProvider(props: Props) {
  const { user } = useAuth();
  return <SharedState key={user?.id ?? "signed-out"} {...props} />;
}
