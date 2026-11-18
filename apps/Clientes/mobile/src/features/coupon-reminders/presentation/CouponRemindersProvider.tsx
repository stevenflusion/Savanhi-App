import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "expo-router";
import Constants from "expo-constants";

import { useAuth } from "@/src/features/auth";

import type {
  ConsentStore,
  NotificationsPort,
  PushDeviceRepository,
} from "../application/ports";
import { parseReminderTap, type ReminderTap } from "../domain/reminder";
import { createConsentStore } from "../infrastructure/consent-store";
import { createExpoNotificationsPort } from "../infrastructure/expo-notifications-port";
import { createPushDeviceFetchRepository } from "../infrastructure/push-device-fetch-repository";
import {
  CouponRemindersContext,
  type CouponReminders,
  type ReminderStatus,
} from "./reminders-context";

const defaultPort = createExpoNotificationsPort();
const defaultRepository = createPushDeviceFetchRepository();
const defaultConsent = createConsentStore();

/** Set by `app.config.js` from `CLIENTES_EAS_PROJECT_ID`; absent means «not configured». */
const configuredProjectId = (): string => {
  const eas = Constants.expoConfig?.extra?.eas;
  return typeof eas?.projectId === "string" ? eas.projectId : "";
};

const SEEN_LIMIT = 50;

type Props = {
  children: ReactNode;
  projectId?: string;
  port?: NotificationsPort;
  repository?: PushDeviceRepository;
  consent?: ConsentStore;
};

/**
 * Coupon expiry reminders, mounted once under `AuthProvider`.
 *
 * Registration. The OS prompt and the first PUT happen only on `enable()`.
 * Later starts register again only for the account that opted in and only while
 * the OS already allows notifications. Every operation takes a generation and
 * is checked after each await; a logout, another account or a preference change
 * bumps it, so a late answer neither publishes state nor sends a request. PUT
 * and DELETE share one queue, so a removal can never be overtaken by an older
 * registration.
 *
 * Taps. A tap is reduced to a claim id and held in memory. It waits for an
 * eligible session of the same account, moves to Billetera, and is resolved
 * there against the authenticated wallet. Nothing in the payload is trusted.
 */
export function CouponRemindersProvider({
  children,
  projectId = configuredProjectId(),
  port = defaultPort,
  repository = defaultRepository,
  consent = defaultConsent,
}: Props) {
  const { gate, user, runProtected } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const userId = gate.status === "ready" ? (user?.id ?? null) : null;
  const supported = Boolean(projectId) && port.isSupported();

  const runProtectedRef = useRef(runProtected);
  runProtectedRef.current = runProtected;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const generation = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const seen = useRef(new Set<string>());
  const navigatedFor = useRef<string | null>(null);

  const [status, setStatus] = useState<ReminderStatus>("checking");
  const [target, setTarget] = useState<{
    claimId: string;
    owner: string | null;
  } | null>(null);

  const enqueue = (task: () => Promise<void>) => {
    queue.current = queue.current.then(task).catch(() => {});
    return queue.current;
  };

  const register = (id: string, interactive: boolean) => {
    const gen = ++generation.current;
    const live = () => generation.current === gen && userIdRef.current === id;
    setStatus("working");
    return enqueue(async () => {
      if (!live()) return;
      try {
        // Android needs the channel before the OS prompt.
        await port.prepareChannel();
        let permission = await port.getPermission();
        if (!live()) return;
        if (permission !== "granted" && interactive) {
          permission = await port.requestPermission();
          if (!live()) return;
        }
        if (permission !== "granted") {
          setStatus("denied");
          return;
        }
        const expoToken = await port.getExpoToken(projectId);
        if (!live()) return;
        if (interactive) {
          await consent.write(id, "on");
          if (!live()) return;
        }
        const outcome = await runProtectedRef.current((accessToken) =>
          repository.register(accessToken, expoToken),
        );
        if (!live()) return;
        if (outcome.status === "ok") {
          setStatus("on");
          return;
        }
        // A refused explicit opt-in is not retried silently at the next start.
        if (interactive) await consent.write(id, "off");
        setStatus("error");
      } catch {
        if (live()) setStatus("error");
      }
    });
  };

  const removeRegistration = (id: string, gen: number) =>
    enqueue(async () => {
      const current = () =>
        generation.current === gen && userIdRef.current === id;
      try {
        // The choice is recorded first, inside the queue, so it also holds when
        // the account is gone before the request can be made.
        await consent.write(id, "removing");
        // Another account is signed in now: its session must not be touched,
        // and this removal stays pending for this account's next eligible start.
        if (userIdRef.current !== id) return;
        const outcome = await runProtectedRef.current((accessToken) =>
          repository.remove(accessToken),
        );
        if (outcome.status === "ok") {
          await consent.write(id, "off");
          if (current()) setStatus("off");
        } else if (current()) {
          setStatus("remove-error");
        }
      } catch {
        if (current()) setStatus("remove-error");
      }
    });

  // Runs for every eligible session (start or login), never before one.
  useEffect(() => {
    generation.current += 1;
    if (!userId) {
      setStatus("checking");
      return;
    }
    if (!supported) {
      setStatus("unavailable");
      return;
    }
    const gen = generation.current;
    setStatus("checking");
    void consent.read(userId).then((choice) => {
      if (generation.current !== gen) return;
      if (choice === "on") void register(userId, false);
      else if (choice === "removing") {
        setStatus("working");
        void removeRegistration(userId, gen);
      } else setStatus("off");
    });
    return () => {
      generation.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, supported]);

  // ---- taps: warm, foreground and the one that launched the app --------------
  useEffect(() => {
    if (!supported) return;
    const onTap = (tap: ReminderTap) => {
      const claimId = parseReminderTap(tap);
      if (!claimId || seen.current.has(tap.id)) return;
      seen.current.add(tap.id);
      if (seen.current.size > SEEN_LIMIT) {
        seen.current.delete(seen.current.values().next().value!);
      }
      port.clearLaunchTap();
      setTarget({ claimId, owner: userIdRef.current });
    };
    const launch = port.readLaunchTap();
    if (launch) onTap(launch);
    return port.subscribe(onTap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  useEffect(() => {
    if (!target || gate.status === "loading") return;
    // Not eligible (signed out, profile gate): a tap never waits for a later login.
    if (!userId) {
      setTarget(null);
      return;
    }
    if (target.owner === null) {
      setTarget({ ...target, owner: userId });
      return;
    }
    if (target.owner !== userId) {
      setTarget(null);
      return;
    }
    if (
      pathname.startsWith("/auth") ||
      pathname === "/wallet" ||
      navigatedFor.current === target.claimId
    ) {
      return;
    }
    navigatedFor.current = target.claimId;
    router.push("/wallet" as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, gate.status, userId, pathname]);

  const walletTarget =
    target && userId && target.owner === userId ? target.claimId : null;

  const value = useMemo<CouponReminders>(
    () => ({
      status: supported ? status : "unavailable",
      enable: async () => {
        const id = userIdRef.current;
        if (id && supported) await register(id, true);
      },
      disable: async () => {
        const id = userIdRef.current;
        if (!id || !supported) return;
        const gen = ++generation.current;
        setStatus("working");
        await removeRegistration(id, gen);
      },
      walletTarget,
      finishTarget: (claimId) => {
        navigatedFor.current = null;
        setTarget((current) => (current?.claimId === claimId ? null : current));
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, supported, walletTarget, projectId],
  );

  return (
    <CouponRemindersContext.Provider value={value}>
      {children}
    </CouponRemindersContext.Provider>
  );
}
