import { useCallback, useEffect, useRef, useState } from "react";
import type { NearbyStore } from "@repo/api-contracts";

import { useAuth } from "@/src/features/auth";

import { coordinatesKey, type Coordinates } from "../domain/location";
import { useDiscoveryShared } from "./DiscoveryProvider";

type NearbyState = {
  /** `null` while the stores for the CURRENT position are being read. */
  items: NearbyStore[] | null;
  /** The stores the customer follows; the nearby answer carries no such flag. */
  followedIds: Set<string> | null;
  error: boolean;
};

const EMPTY: NearbyState = { items: null, followedIds: null, error: false };

/**
 * The stores within range of one position, plus who the customer follows.
 * Both reads go through `runProtected`. A new position starts from nothing:
 * the stores of an older position are never shown for the new one, and an
 * answer that belongs to an older position or read is dropped.
 */
export function useNearbyStores(coordinates: Coordinates) {
  const { runProtected } = useAuth();
  const { repository, followOverride, pendingStores, followError, changeFollow } =
    useDiscoveryShared();
  const key = coordinatesKey(coordinates);
  const [state, setState] = useState<NearbyState>(EMPTY);

  const runProtectedRef = useRef(runProtected);
  runProtectedRef.current = runProtected;
  const coordinatesRef = useRef(coordinates);
  coordinatesRef.current = coordinates;
  const keyRef = useRef(key);
  keyRef.current = key;
  const alive = useRef(true);
  const readSequence = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const sequence = ++readSequence.current;
    const readKey = key;
    const position = coordinatesRef.current;
    const isCurrent = () =>
      alive.current &&
      sequence === readSequence.current &&
      readKey === keyRef.current;
    setState((current) => ({ ...current, error: false }));

    const nearby = await runProtectedRef.current((token) =>
      repository.getNearbyStores(token, position),
    );
    if (!isCurrent() || nearby.status === "ignored") return;
    if (nearby.status === "failed") {
      setState({ ...EMPTY, error: true });
      return;
    }
    const followed = await runProtectedRef.current((token) =>
      repository.getFollowedStores(token),
    );
    if (!isCurrent() || followed.status === "ignored") return;
    if (followed.status === "failed") {
      // Without the followed list a «Siguiendo» label would be a guess.
      setState({ ...EMPTY, error: true });
      return;
    }
    setState({
      items: nearby.data,
      followedIds: new Set(followed.data.map((store) => store.id)),
      error: false,
    });
  }, [repository, key]);

  useEffect(() => {
    setState(EMPTY);
    void load();
  }, [load]);

  return {
    items: state.items,
    error: state.error,
    followError,
    pendingStores,
    isFollowed: (store: NearbyStore) =>
      followOverride[store.id] ?? state.followedIds?.has(store.id) ?? false,
    changeFollow,
    reload: load,
  };
}
