import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/src/features/auth";

import type {
  DiscoveryRemoteRepository,
  ForegroundLocationPort,
} from "../application/ports";
import type { Coordinates, LocationPermission } from "../domain/location";
import { createDiscoveryFetchRepository } from "../infrastructure/discovery-fetch-repository";
import { createDeviceLocation } from "../infrastructure/foreground-location";

const defaultRepository = createDiscoveryFetchRepository();
const defaultLocation = createDeviceLocation();

export type LocationState = {
  /** `unknown` until the OS has been asked once in this session. */
  permission: "unknown" | LocationPermission;
  /** The held position, in memory only. `null` means "none", never `0,0`. */
  coordinates: Coordinates | null;
  status: "idle" | "locating" | "error";
};

type DiscoveryShared = {
  repository: DiscoveryRemoteRepository;
  location: LocationState;
  /** Mapa gained focus: the only moment the OS may be asked. */
  openMap: () => void;
  /** An explicit «Reintentar» after a failed reading. */
  retryLocation: () => void;
  /** Confirmed follow results by store, for every screen that shows a store. */
  followOverride: Record<string, boolean>;
  pendingStores: string[];
  followError: boolean;
  /** Increases once per confirmed follow change, never on a read. */
  revision: number;
  changeFollow: (storeId: string, following: boolean) => Promise<void>;
  /**
   * Asks the feed for one authoritative re-read. It is the same revision seam a
   * follow uses; Billetera calls it after a claim, and it never loops by itself.
   */
  refreshFeed: () => void;
};

const DiscoveryContext = createContext<DiscoveryShared | null>(null);

export function useDiscoveryShared(): DiscoveryShared {
  const shared = useContext(DiscoveryContext);
  if (!shared) {
    throw new Error("useDiscoveryShared must be used within DiscoveryProvider");
  }
  return shared;
}

export const useHasDiscoveryProvider = () => useContext(DiscoveryContext) !== null;

type Props = {
  repository?: DiscoveryRemoteRepository;
  location?: ForegroundLocationPort;
  children: ReactNode;
};

/**
 * The one place Inicio and Mapa agree on. Both tabs stay mounted once opened,
 * so a position or a follow made on one must be visible to the other. All of it
 * lives in memory and only while the protected tabs are mounted: closing the
 * gate (logout, a refused profile) unmounts this provider, which drops the
 * position and invalidates every answer still in flight.
 */
function SharedState({
  repository = defaultRepository,
  location: port = defaultLocation,
  children,
}: Props) {
  const { runProtected } = useAuth();
  const runProtectedRef = useRef(runProtected);
  runProtectedRef.current = runProtected;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // ---- foreground location -------------------------------------------------
  const [location, setLocation] = useState<LocationState>({
    permission: "unknown",
    coordinates: null,
    status: "idle",
  });
  const held = useRef<Coordinates | null>(null);
  const mapOpened = useRef(false);
  // Bumped whenever the OS is learned to no longer grant the permission. Every
  // position pass remembers the epoch it started in and publishes nothing once
  // it has changed, so a reading that answers after a revocation is dropped.
  const epoch = useRef(0);
  // True only while the system permission dialog is showing.
  const requesting = useRef(false);
  const passCounter = useRef(0);
  const running = useRef<{ id: number; promise: Promise<void> } | null>(null);

  /** The OS no longer grants the permission: forget the position at once. */
  const revoke = useCallback((permission: LocationPermission) => {
    epoch.current += 1;
    held.current = null;
    running.current = null;
    setLocation({ permission, coordinates: null, status: "idle" });
  }, []);

  /**
   * One pass over the OS, coalesced: a trigger that arrives while another pass
   * is running (for example the Mapa focus that overlaps the permission
   * dialog) joins it instead of starting a second prompt or reading.
   * `request` is only ever true for an explicit Mapa trigger, and even then
   * the OS is asked only while the permission is still undetermined.
   */
  const sync = useCallback(
    (mode: { request: boolean; read: "always" | "ifMissing" }) => {
      if (running.current) return running.current.promise;
      const id = ++passCounter.current;
      const startEpoch = epoch.current;
      const current = () => alive.current && epoch.current === startEpoch;
      const promise = (async () => {
        setLocation((c) =>
          c.coordinates ? c : { ...c, status: "locating" },
        );
        try {
          let permission = await port.getPermission();
          if (!current()) return;
          if (permission === "undetermined" && mode.request) {
            requesting.current = true;
            try {
              permission = await port.requestPermission();
            } finally {
              requesting.current = false;
            }
            if (!current()) return;
          }
          if (permission !== "granted") {
            // Denied, or revoked from the OS settings: nothing is kept.
            revoke(permission);
            return;
          }
          if (mode.read === "ifMissing" && held.current) {
            setLocation((c) => ({ ...c, permission, status: "idle" }));
            return;
          }
          setLocation((c) => ({ ...c, permission, status: "locating" }));
          const position = await port.getPosition();
          if (!current()) return;
          held.current = position;
          setLocation({ permission, coordinates: position, status: "idle" });
        } catch {
          // A failed reading keeps whatever position is already held.
          if (current()) setLocation((c) => ({ ...c, status: "error" }));
        }
      })().finally(() => {
        // A pass that was invalidated must not clear a newer pass's pointer.
        if (running.current?.id === id) running.current = null;
      });
      running.current = { id, promise };
      return promise;
    },
    [port, revoke],
  );

  const openMap = useCallback(() => {
    mapOpened.current = true;
    void sync({ request: true, read: "always" });
  }, [sync]);

  // Passive: it only listens, and only once Mapa has been opened. A return to
  // the foreground READS the permission right away, independently of any
  // reading that is still pending, because a revocation must not wait for (or
  // be overtaken by) an old position. It never requests anything.
  useEffect(
    () =>
      port.onForeground(() => {
        if (!mapOpened.current) return;
        void (async () => {
          // The dialog's own pass reads its answer; a status read taken while
          // it is open would only see "undetermined".
          if (requesting.current) return;
          let permission: LocationPermission;
          try {
            permission = await port.getPermission();
          } catch {
            return;
          }
          if (!alive.current || requesting.current) return;
          if (permission !== "granted") {
            // "Undetermined" while a pass is still on its way to the dialog is
            // not a revocation: that pass asks, and must not be cancelled.
            if (permission === "undetermined" && running.current) return;
            revoke(permission);
            return;
          }
          if (!held.current && !running.current) {
            void sync({ request: false, read: "ifMissing" });
          }
        })();
      }),
    [port, sync, revoke],
  );

  // ---- follow / unfollow, the only mutation path -----------------------------
  const [followOverride, setFollowOverride] = useState<Record<string, boolean>>(
    {},
  );
  const [pendingStores, setPendingStores] = useState<string[]>([]);
  const [followError, setFollowError] = useState(false);
  const [revision, setRevision] = useState(0);
  const pending = useRef(new Set<string>());

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
      setRevision((current) => current + 1);
    },
    [repository],
  );

  const refreshFeed = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  const value = useMemo<DiscoveryShared>(
    () => ({
      repository,
      location,
      openMap,
      retryLocation: openMap,
      followOverride,
      pendingStores,
      followError,
      revision,
      changeFollow,
      refreshFeed,
    }),
    [
      repository,
      location,
      openMap,
      followOverride,
      pendingStores,
      followError,
      revision,
      changeFollow,
      refreshFeed,
    ],
  );

  return (
    <DiscoveryContext.Provider value={value}>
      {children}
    </DiscoveryContext.Provider>
  );
}

/** Keyed by customer, so a different login never inherits another's state. */
export function DiscoveryProvider(props: Props) {
  const { user } = useAuth();
  return <SharedState key={user?.id ?? "signed-out"} {...props} />;
}
