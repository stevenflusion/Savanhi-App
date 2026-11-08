import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomerCouponFeedItem } from "@repo/api-contracts";

import { useAuth } from "@/src/features/auth";

import type { DiscoveryRemoteRepository } from "../application/ports";
import { createDiscoveryFetchRepository } from "../infrastructure/discovery-fetch-repository";

const defaultRepository = createDiscoveryFetchRepository();

export type FeedError = "coupons" | "stores";

type FeedState = {
  /** `null` until the first read answers; kept while a later read fails. */
  items: CustomerCouponFeedItem[] | null;
  /** Only read when the feed is empty, to tell the two empty states apart. */
  followedStoreCount: number | null;
  error: FeedError | null;
};

/**
 * The state of the single Inicio feed, held in memory only.
 *
 * Every request goes through `runProtected`, so the session machinery decides
 * about tokens, refreshes and a lost or replaced session; whatever it reports
 * as `ignored` is dropped here without touching the screen. A follow changes
 * what is shown only after the server confirms it, and a confirmed change is
 * followed by a fresh read so the feed itself stays authoritative.
 */
export function useDiscoveryFeed(
  repository: DiscoveryRemoteRepository = defaultRepository,
) {
  const { runProtected } = useAuth();
  const [state, setState] = useState<FeedState>({
    items: null,
    followedStoreCount: null,
    error: null,
  });
  const [followOverride, setFollowOverride] = useState<Record<string, boolean>>(
    {},
  );
  const [pendingStores, setPendingStores] = useState<string[]>([]);
  const [followError, setFollowError] = useState(false);

  // Refs keep the latest values for work that outlives a render.
  const runProtectedRef = useRef(runProtected);
  runProtectedRef.current = runProtected;
  const alive = useRef(true);
  // A read is only applied while it is still the newest one.
  const readSequence = useRef(0);
  const pending = useRef(new Set<string>());

  const load = useCallback(async () => {
    const sequence = ++readSequence.current;
    const isCurrent = () => alive.current && sequence === readSequence.current;
    setState((current) => ({ ...current, error: null }));

    const feed = await runProtectedRef.current((token) =>
      repository.getFeed(token),
    );
    if (!isCurrent() || feed.status === "ignored") return;
    if (feed.status === "failed") {
      setState((current) => ({ ...current, error: "coupons" }));
      return;
    }

    let followedStoreCount: number | null = null;
    if (feed.data.length === 0) {
      const followed = await runProtectedRef.current((token) =>
        repository.getFollowedStores(token),
      );
      if (!isCurrent() || followed.status === "ignored") return;
      if (followed.status === "failed") {
        setState({ items: feed.data, followedStoreCount: null, error: "stores" });
        return;
      }
      followedStoreCount = followed.data.length;
    }

    // The fresh feed already says which stores are followed.
    setFollowOverride({});
    setState({ items: feed.data, followedStoreCount, error: null });
  }, [repository]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const changeFollow = useCallback(
    async (storeId: string, following: boolean) => {
      // One action per store at a time: a second tap is the same intent.
      if (pending.current.has(storeId)) return;
      pending.current.add(storeId);
      setPendingStores([...pending.current]);
      setFollowError(false);

      const outcome = await runProtectedRef.current((token) =>
        repository.setFollow(token, storeId, following),
      );
      pending.current.delete(storeId);
      if (!alive.current) return;
      setPendingStores([...pending.current]);
      if (outcome.status === "ignored") return;
      if (outcome.status === "failed") {
        setFollowError(true);
        return;
      }

      // The answer is the end state; only a real change needs a new read.
      if (outcome.data.following === !following) return;
      setFollowOverride((current) => ({
        ...current,
        [storeId]: outcome.data.following,
      }));
      void load();
    },
    [load, repository],
  );

  return {
    items: state.items,
    followedStoreCount: state.followedStoreCount,
    error: state.error,
    followError,
    pendingStores,
    isFollowed: (item: CustomerCouponFeedItem) =>
      followOverride[item.store.id] ?? item.followed,
    changeFollow,
    reload: load,
  };
}
