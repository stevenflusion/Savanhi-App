import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomerCouponFeedItem } from "@repo/api-contracts";

import { useAuth } from "@/src/features/auth";

import { coordinatesKey } from "../domain/location";
import { useDiscoveryShared } from "./DiscoveryProvider";

export type FeedError = "coupons" | "stores";

type FeedState = {
  /** `null` until the first read answers; kept while a later read fails. */
  items: CustomerCouponFeedItem[] | null;
  /** Only read when the feed is empty, to tell the two empty states apart. */
  followedStoreCount: number | null;
  error: FeedError | null;
};

const EMPTY: FeedState = { items: null, followedStoreCount: null, error: null };

/**
 * The state of the single Inicio feed, held in memory only.
 *
 * Every request goes through `runProtected`, so the session machinery decides
 * about tokens, refreshes and a lost or replaced session; whatever it reports
 * as `ignored` is dropped here without touching the screen. The position, if
 * Mapa has produced one, comes from the shared provider and is sent as the
 * `lat`/`lng` pair; without one the request has no query at all. A follow
 * changes what is shown only after the server confirms it, and a confirmed
 * change (from either screen) is followed by a fresh read.
 */
export function useDiscoveryFeed() {
  const { runProtected } = useAuth();
  const shared = useDiscoveryShared();
  const { repository, revision, followOverride, changeFollow } = shared;
  const coordinates = shared.location.coordinates;
  const key = coordinatesKey(coordinates);
  const [state, setState] = useState<FeedState>(EMPTY);

  // Refs keep the latest values for work that outlives a render.
  const runProtectedRef = useRef(runProtected);
  runProtectedRef.current = runProtected;
  const keyRef = useRef(key);
  keyRef.current = key;
  const alive = useRef(true);
  // A read is only applied while it is still the newest one.
  const readSequence = useRef(0);
  const previousKey = useRef(key);

  const load = useCallback(async () => {
    const sequence = ++readSequence.current;
    const readKey = key;
    const isCurrent = () =>
      alive.current &&
      sequence === readSequence.current &&
      readKey === keyRef.current;
    setState((current) => ({ ...current, error: null }));

    const feed = await runProtectedRef.current((token) =>
      repository.getFeed(token, coordinates ?? undefined),
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

    setState({ items: feed.data, followedStoreCount, error: null });
    // The position is part of the request identity, so `coordinates` itself
    // is deliberately not a dependency: its key is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, key]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    // Losing the position invalidates every item read with it: the nearby-only
    // coupons and their distances must not stay on screen as current.
    if (previousKey.current !== "none" && key === "none") setState(EMPTY);
    previousKey.current = key;
    void load();
  }, [load, revision, key]);

  return {
    items: state.items,
    followedStoreCount: state.followedStoreCount,
    error: state.error,
    followError: shared.followError,
    pendingStores: shared.pendingStores,
    isFollowed: (item: CustomerCouponFeedItem) =>
      followOverride[item.store.id] ?? item.followed,
    changeFollow,
    reload: load,
  };
}
