// The real reminder intake (provider, port, repository, consent store) under the
// real auth provider and the real Billetera screen. Only the native module, the
// router edge and fetch are faked; no push or credential is involved.
import {
  CLAIMS_GET,
  CLAIM_1,
  COPY,
  COUPON_1,
  COUPON_A,
  PROFILE_GET,
  REISSUE,
  WalletApp,
  WalletTabs,
  acc,
  backing,
  callsTo,
  calls,
  claimRecord,
  deferred,
  focusWallet,
  inicio,
  installWalletHarness,
  logged,
  mockNav,
  Probe,
  probeAuth,
  reply,
  routes,
  seed,
  settle,
  user,
  visited,
  wallet,
  walletUi,
  walletView,
} from "./wallet-test-utils";

import React from "react";
import { Platform, View } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { AuthGuard } from "@/src/features/auth/presentation/AuthGuard";
import { AuthProvider } from "@/src/features/auth/presentation/AuthProvider";
import { reminderConsentKey } from "@/src/features/coupon-reminders/infrastructure/consent-store";
import { CouponRemindersProvider } from "@/src/features/coupon-reminders/presentation/CouponRemindersProvider";
import { useCouponReminders } from "@/src/features/coupon-reminders/presentation/reminders-context";

jest.mock("expo-notifications", () => {
  const initial = () => ({
    permission: "undetermined",
    onRequest: "granted",
    token: "ExponentPushToken[synthetic-token-aaaa]",
    listeners: [] as Array<(response: unknown) => void>,
    last: null as unknown,
    order: [] as string[],
    requestGate: null as Promise<void> | null,
  });
  const state = initial();
  const permissions = () => ({
    status: state.permission,
    granted: state.permission === "granted",
    canAskAgain: state.permission !== "denied",
  });
  const mock = {
    __state: state,
    __reset: () => {
      Object.assign(state, initial());
      Object.values(mock).forEach((value) => (value as jest.Mock)?.mockClear?.());
    },
    DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
    AndroidImportance: { DEFAULT: 3 },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => {
      state.order.push("channel");
      return null;
    }),
    getPermissionsAsync: jest.fn(async () => permissions()),
    requestPermissionsAsync: jest.fn(async () => {
      state.order.push("request");
      if (state.requestGate) await state.requestGate;
      state.permission = state.onRequest;
      return permissions();
    }),
    getExpoPushTokenAsync: jest.fn(async () => ({
      type: "expo",
      data: state.token,
    })),
    addNotificationResponseReceivedListener: jest.fn(
      (listener: (response: unknown) => void) => {
        state.listeners.push(listener);
        return {
          remove: () => {
            state.listeners = state.listeners.filter((l) => l !== listener);
          },
        };
      },
    ),
    getLastNotificationResponse: jest.fn(() => state.last),
    clearLastNotificationResponse: jest.fn(() => {
      state.last = null;
    }),
  };
  return mock;
});

const N = jest.requireMock("expo-notifications");
const DEFAULT_ACTION = "expo.modules.notifications.actions.DEFAULT";
const PUSH = "PUT /api/v1/clientes/push-device";
const REMOVE = "DELETE /api/v1/clientes/push-device";
const TOKEN = "ExponentPushToken[synthetic-token-aaaa]";
const PROJECT = "00000000-0000-4000-8000-000000000000";
const MISSING_CLAIM = "d9999999-9999-4999-8999-999999999999";
const CONSENT = reminderConsentKey("user-1");

const R = {
  title: "Recordatorios de cupones",
  enable: "Activar recordatorios",
  disable: "Desactivar recordatorios",
  on: "Recordatorios activados",
  working: "Un momento…",
  denied:
    "Savanhi no tiene permiso para enviarte notificaciones. Actívalo en los ajustes de tu teléfono e intenta de nuevo",
  error: "No pudimos activar los recordatorios. Intenta de nuevo",
  removeError: "No pudimos desactivar los recordatorios. Intenta de nuevo",
  opened: "Cupón de tu recordatorio",
  retry: "Reintentar",
};

type PushInit = { method?: string; headers: Record<string, string>; body?: string };
const pushInits: PushInit[] = [];

let reminders: NonNullable<ReturnType<typeof useCouponReminders>>;
function RemindersProbe() {
  reminders = useCouponReminders()!;
  return null;
}

function RemindersApp({ projectId = PROJECT }: { projectId?: string }) {
  const [path, setPath] = React.useState("/");
  mockNav.go = (href: string) => {
    if (href.startsWith("/auth") || href === "/") setPath(href);
    else {
      visited.push(href);
      if (href === "/wallet") walletUi.setWalletFocus(true);
    }
  };
  mockNav.path = path;
  return (
    <AuthProvider>
      <Probe />
      <CouponRemindersProvider projectId={projectId}>
        <RemindersProbe />
        {path === "/" ? (
          <WalletTabs />
        ) : (
          <AuthGuard area="auth">
            <View testID={`auth-area:${path}`} />
          </AuthGuard>
        )}
      </CouponRemindersProvider>
    </AuthProvider>
  );
}

let platform: ReturnType<typeof jest.replaceProperty>;
installWalletHarness();
beforeEach(() => {
  N.__reset();
  pushInits.length = 0;
  platform = jest.replaceProperty(Platform, "OS", "android");
  const inner = (global as any).fetch as jest.Mock;
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    if (String(url).includes("/push-device")) {
      pushInits.push({
        method: init.method,
        headers: init.headers as Record<string, string>,
        body: init.body as string | undefined,
      });
    }
    return inner(url, init);
  });
  routes.set(PUSH, () => reply(204, null));
  routes.set(REMOVE, () => reply(204, null));
  wallet.claims = [claimRecord(CLAIM_1, COUPON_1, "claimed")];
});
afterEach(() => platform.restore());

const tapResponse = (
  claimId: unknown,
  over: { id?: string; action?: string; type?: string } = {},
) => ({
  actionIdentifier: over.action ?? DEFAULT_ACTION,
  notification: {
    request: {
      identifier: over.id ?? "notification-1",
      content: {
        data: { type: over.type ?? "coupon-expiry-reminder", claimId },
      },
    },
  },
});
const tap = (...args: Parameters<typeof tapResponse>) =>
  act(async () => {
    for (const listener of [...N.__state.listeners]) listener(tapResponse(...args));
  });

async function openSignedIn() {
  seed();
  const view = render(<RemindersApp />);
  await screen.findByTestId("inicio");
  await inicio().findByText(COUPON_A);
  return view;
}
async function openWallet() {
  const view = await openSignedIn();
  await focusWallet();
  return view;
}
const press = async (label: string) => {
  fireEvent.press(await walletView().findByText(label));
  await settle();
};
const noNativeCalls = () => {
  expect(N.getPermissionsAsync).not.toHaveBeenCalled();
  expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
  expect(N.setNotificationChannelAsync).not.toHaveBeenCalled();
};

describe("opt-in from Billetera", () => {
  it("asks the OS for nothing at welcome or at start, and registers nothing", async () => {
    render(<RemindersApp />);
    await screen.findByTestId("auth-area:/auth/welcome");
    noNativeCalls();
    screen.unmount();

    await openWallet();
    expect(await walletView().findByText(R.title)).toBeTruthy();
    expect(walletView().getByText(R.enable)).toBeTruthy();
    noNativeCalls();
    expect(callsTo(PUSH)).toHaveLength(0);
  });

  it("registers the Expo token only after the explicit action, channel first", async () => {
    await openWallet();
    await press(R.enable);

    expect(N.__state.order).toEqual(["channel", "request"]);
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: PROJECT });
    expect(callsTo(PUSH)).toHaveLength(1);
    expect(pushInits[0]!.method).toBe("PUT");
    expect(pushInits[0]!.headers.Authorization).toBe(`Bearer ${acc(1)}`);
    expect(JSON.parse(pushInits[0]!.body!)).toEqual({ expoToken: TOKEN });
    expect(backing.get(CONSENT)).toBe("on");
    expect(walletView().getByText(R.on)).toBeTruthy();
    expect(walletView().getByText(R.disable)).toBeTruthy();
    expect(logged()).not.toContain(TOKEN);
  });

  it("shows a busy, non-actionable control while the work is pending", async () => {
    const gate = deferred<void>();
    N.__state.requestGate = gate.promise;
    await openWallet();
    await press(R.enable);

    const busy = walletView().getByText(R.working);
    expect(busy).toBeTruthy();
    expect(walletView().queryByText(R.enable)).toBeNull();
    await act(async () => gate.resolve());
    await settle();
    expect(walletView().getByText(R.on)).toBeTruthy();
  });

  it("registers nothing and stores no consent when the OS denies the permission", async () => {
    N.__state.onRequest = "denied";
    await openWallet();
    await press(R.enable);

    expect(walletView().getByText(R.denied)).toBeTruthy();
    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(callsTo(PUSH)).toHaveLength(0);
    expect(backing.has(CONSENT)).toBe(false);
  });

  it("fails safely when no token can be had or the server refuses, keeping no consent", async () => {
    N.getExpoPushTokenAsync.mockRejectedValueOnce(new Error("offline"));
    await openWallet();
    await press(R.enable);
    expect(walletView().getByText(R.error)).toBeTruthy();
    expect(callsTo(PUSH)).toHaveLength(0);
    expect(backing.has(CONSENT)).toBe(false);

    routes.set(PUSH, () => reply(500, {}));
    await press(R.retry);
    expect(walletView().getByText(R.error)).toBeTruthy();
    expect(callsTo(PUSH)).toHaveLength(1);
    expect(backing.has(CONSENT)).toBe(false);
    expect(logged()).not.toContain(TOKEN);
  });

  it("stays hidden, and touches nothing native, when the build has no project id or is not Android", async () => {
    seed();
    render(<RemindersApp projectId="" />);
    await screen.findByTestId("inicio");
    await focusWallet();
    expect(walletView().queryByText(R.title)).toBeNull();
    screen.unmount();

    (platform as unknown as { replaceValue: (v: string) => void }).replaceValue("ios");
    await openWallet();
    expect(walletView().queryByText(R.title)).toBeNull();
    noNativeCalls();
    expect(N.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
  });
});

describe("opt-out", () => {
  it("removes the registration, forgets the consent and leaves the OS permission alone", async () => {
    await openWallet();
    await press(R.enable);
    calls.length = 0;
    pushInits.length = 0;
    await press(R.disable);

    expect(callsTo(REMOVE)).toHaveLength(1);
    expect(pushInits[0]!.method).toBe("DELETE");
    expect(pushInits[0]!.headers.Authorization).toBe(`Bearer ${acc(1)}`);
    expect(backing.has(CONSENT)).toBe(false);
    expect(walletView().getByText(R.enable)).toBeTruthy();
    expect(N.__state.permission).toBe("granted");

    // A restart does not register again, although the OS still allows it.
    screen.unmount();
    calls.length = 0;
    N.__reset();
    N.__state.permission = "granted";
    await openWallet();
    expect(walletView().getByText(R.enable)).toBeTruthy();
    expect(callsTo(PUSH)).toHaveLength(0);
    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it("keeps the removal pending after a failure and retries it, also at the next start", async () => {
    await openWallet();
    await press(R.enable);
    routes.set(REMOVE, () => reply(500, {}));
    await press(R.disable);
    expect(walletView().getByText(R.removeError)).toBeTruthy();
    expect(backing.get(CONSENT)).toBe("removing");

    routes.set(REMOVE, () => reply(204, null));
    await press(R.retry);
    expect(walletView().getByText(R.enable)).toBeTruthy();
    expect(backing.has(CONSENT)).toBe(false);

    backing.set(CONSENT, "removing");
    screen.unmount();
    calls.length = 0;
    await openWallet();
    await settle();
    expect(callsTo(REMOVE)).toHaveLength(1);
    expect(callsTo(PUSH)).toHaveLength(0);
    expect(backing.has(CONSENT)).toBe(false);
  });
});

describe("eligible restart", () => {
  it("registers again for the account that opted in, without any prompt", async () => {
    backing.set(CONSENT, "on");
    N.__state.permission = "granted";
    await openWallet();
    await settle();

    expect(callsTo(PUSH)).toHaveLength(1);
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(walletView().getByText(R.on)).toBeTruthy();
  });

  it("never prompts when the permission was revoked, and says so", async () => {
    backing.set(CONSENT, "on");
    N.__state.permission = "denied";
    await openWallet();
    await settle();

    expect(callsTo(PUSH)).toHaveLength(0);
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(walletView().getByText(R.denied)).toBeTruthy();
  });

  it("does not opt another account in because the OS already allows notifications", async () => {
    backing.set(CONSENT, "on"); // user-1 only
    N.__state.permission = "granted";
    seed(user({ id: "user-2", email: "otra@example.test" }));
    render(<RemindersApp />);
    await screen.findByTestId("inicio");
    await focusWallet();
    await settle();

    expect(walletView().getByText(R.enable)).toBeTruthy();
    expect(callsTo(PUSH)).toHaveLength(0);
    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });
});

describe("generations", () => {
  it("never lets a registration that was open when the preference went off land after the removal", async () => {
    const put = deferred();
    routes.set(PUSH, () => put.promise);
    await openWallet();

    await act(async () => void reminders.enable());
    await settle();
    expect(callsTo(PUSH)).toHaveLength(1);

    await act(async () => void reminders.disable());
    await settle();
    expect(callsTo(REMOVE)).toHaveLength(0); // queued behind the open request

    await act(async () => put.resolve(reply(204, null)));
    await settle();
    expect(calls.map((c) => c.key).filter((k) => k.includes("push-device"))).toEqual([
      PUSH,
      REMOVE,
    ]);
    expect(walletView().getByText(R.enable)).toBeTruthy();
    expect(backing.has(CONSENT)).toBe(false);
  });

  it("sends nothing for an account that signed out while the OS prompt was open", async () => {
    const gate = deferred<void>();
    N.__state.requestGate = gate.promise;
    await openWallet();
    await press(R.enable);

    await act(async () => probeAuth.logout());
    await act(async () => gate.resolve());
    await settle();

    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(callsTo(PUSH)).toHaveLength(0);
    expect(callsTo(REMOVE)).toHaveLength(0);
  });

  it("does not send a queued removal under the next account's session, and keeps it pending", async () => {
    const put = deferred();
    routes.set(PUSH, () => put.promise);
    await openWallet();
    await act(async () => void reminders.enable());
    await settle();
    await act(async () => void reminders.disable());
    routes.set("POST /auth/logout", () => reply(200, {}));
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: user({ id: "user-2", email: "b@example.test" }),
        session: {
          accessToken: "access-user-2",
          refreshToken: "refresh-user-2-unique",
          expiresIn: 900,
        },
      }),
    );
    await act(async () => probeAuth.logout());
    await act(async () => {
      await probeAuth.verifyOTP("b@example.test", "challenge", "123456");
    });
    await screen.findByTestId("inicio");
    await act(async () => put.resolve(reply(204, null)));
    await settle();

    // The second account's registration is never touched, and the first
    // account's removal stays pending for its own next start.
    expect(callsTo(REMOVE)).toHaveLength(0);
    expect(callsTo(PUSH)).toHaveLength(1);
    expect(backing.get(CONSENT)).toBe("removing");
  });

  it("ignores the answer of a registration that signed out while it was in flight", async () => {
    const put = deferred();
    routes.set(PUSH, () => put.promise);
    await openWallet();
    await press(R.enable);
    expect(callsTo(PUSH)).toHaveLength(1);

    await act(async () => probeAuth.logout());
    await act(async () => put.resolve(reply(204, null)));
    await settle();

    expect(callsTo(PUSH)).toHaveLength(1);
    expect(callsTo(REMOVE)).toHaveLength(0);
    expect(screen.queryByTestId("billetera")).toBeNull();
  });
});

describe("notification taps", () => {
  const readsOfWallet = () => callsTo(CLAIMS_GET).length;

  it("opens Billetera on the claim, with its store and validity, and no QR", async () => {
    await openSignedIn();
    await tap(CLAIM_1);
    await settle();

    expect(visited).toEqual(["/wallet"]);
    const view = walletView();
    expect(await view.findByText(R.opened)).toBeTruthy();
    expect(view.getByText(COUPON_A)).toBeTruthy();
    expect(view.getByText("Tienda Doña Rosa")).toBeTruthy();
    expect(view.getByText("Disponible")).toBeTruthy();
    expect(view.getByText(COPY.viewQr)).toBeTruthy();
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(0);
    expect(screen.queryByText(COPY.qrInstruction)).toBeNull();
  });

  it("handles one Expo replay of the same response once", async () => {
    await openSignedIn();
    await tap(CLAIM_1, { id: "same" });
    await settle();
    const reads = readsOfWallet();

    await tap(CLAIM_1, { id: "same" });
    await settle();
    expect(visited).toEqual(["/wallet"]);
    expect(readsOfWallet()).toBe(reads);
  });

  it("ignores another notification, another action and a malformed claim id", async () => {
    await openSignedIn();
    await tap(CLAIM_1, { type: "promo", id: "a" });
    await tap(CLAIM_1, { action: "custom", id: "b" });
    await tap("../wallet?x=1", { id: "c" });
    await tap(undefined, { id: "d" });
    await settle();

    expect(visited).toEqual([]);
    expect(readsOfWallet()).toBe(0);
    expect(N.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it("waits for the gate on a cold start, then opens once and clears the launch response", async () => {
    const profile = deferred();
    N.__state.last = tapResponse(CLAIM_1, { id: "cold" });
    seed();
    routes.set(PROFILE_GET, () => profile.promise);
    render(<RemindersApp />);
    await settle();
    expect(visited).toEqual([]);
    expect(readsOfWallet()).toBe(0);

    await act(async () =>
      profile.resolve(
        reply(200, {
          data: { fullName: "Ana Pérez", birthDate: "1990-01-01", eligibility: "eligible" },
        }),
      ),
    );
    await settle();
    expect(visited).toEqual(["/wallet"]);
    expect(N.clearLastNotificationResponse).toHaveBeenCalled();

    // The same response delivered again by the listener is the same tap.
    await tap(CLAIM_1, { id: "cold" });
    await settle();
    expect(visited).toEqual(["/wallet"]);
  });

  it("drops a tap that arrives while signed out and never opens a wallet for the next login", async () => {
    render(<RemindersApp />);
    await screen.findByTestId("auth-area:/auth/welcome");
    await tap(CLAIM_1);
    await settle();

    expect(visited).toEqual([]);
    expect(readsOfWallet()).toBe(0);
    expect(screen.queryByTestId("billetera")).toBeNull();
  });

  it("does not highlight a claim that is not in this wallet, and does not say so", async () => {
    await openSignedIn();
    await tap(MISSING_CLAIM);
    await settle();

    const view = walletView();
    expect(await view.findByText(COUPON_A)).toBeTruthy();
    expect(view.queryByText(R.opened)).toBeNull();
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText(COPY.viewQr)).toBeTruthy();
  });

  it("shows a claim that is no longer available with its own status and no highlight", async () => {
    wallet.claims = [claimRecord(CLAIM_1, COUPON_1, "released")];
    await openSignedIn();
    await tap(CLAIM_1);
    await settle();

    const view = walletView();
    expect(await view.findByText("Devuelto")).toBeTruthy();
    expect(view.queryByText(R.opened)).toBeNull();
    expect(view.queryByText(COPY.viewQr)).toBeNull();
  });

  it("leaves a usable wallet when the read fails, and a later retry does not replay the tap", async () => {
    routes.set(CLAIMS_GET, () => reply(500, {}));
    await openSignedIn();
    await tap(CLAIM_1);
    await settle();
    expect(await walletView().findByText(COPY.walletError)).toBeTruthy();
    expect(walletView().queryByText(R.opened)).toBeNull();

    routes.set(CLAIMS_GET, () =>
      reply(200, { data: wallet.claims.map((c) => ({ ...c, qrToken: null })) }),
    );
    await press(COPY.retry);
    expect(await walletView().findByText(COUPON_A)).toBeTruthy();
    expect(walletView().queryByText(R.opened)).toBeNull();
  });

  it("does not carry a pending tap over to a later session", async () => {
    const claims = deferred();
    await openSignedIn();
    routes.set(CLAIMS_GET, () => claims.promise);
    await tap(CLAIM_1);
    await settle();

    await act(async () => probeAuth.logout());
    await act(async () =>
      claims.resolve(reply(200, { data: wallet.claims.map((c) => ({ ...c, qrToken: null })) })),
    );
    await settle();
    expect(screen.queryByTestId("billetera")).toBeNull();
    expect(screen.queryByText(R.opened)).toBeNull();
  });
});

describe("Billetera without a reminder provider", () => {
  it("keeps the normal wallet and shows no reminder card", async () => {
    seed();
    render(<WalletApp />);
    await screen.findByTestId("inicio");
    await focusWallet();
    expect(await walletView().findByText(COUPON_A)).toBeTruthy();
    expect(walletView().queryByText(R.title)).toBeNull();
    noNativeCalls();
  });
});

// Pinned from the independent T4 verification (same harness, no behavior change).
const unchanged = () => {
  const view = walletView();
  expect(view.queryByText(R.opened)).toBeNull();
  expect(view.queryByRole("alert")).toBeNull();
};

describe("independent verifier probes", () => {
  it("no config: provider inert, cold launch tap ignored, no handler or listener", async () => {
    N.__state.last = tapResponse(CLAIM_1, { id: "cold" });
    seed();
    render(<RemindersApp projectId="" />);
    await screen.findByTestId("inicio");
    await inicio().findByText(COUPON_A);
    await focusWallet();
    await settle();
    noNativeCalls();
    expect(N.setNotificationHandler).not.toHaveBeenCalled();
    expect(N.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    expect(N.getLastNotificationResponse).not.toHaveBeenCalled();
    expect(visited).toEqual([]);
    expect(walletView().queryByText(R.title)).toBeNull();
    expect(callsTo(PUSH)).toHaveLength(0);
  });

  it("account switch while the token is pending: nothing is PUT for anyone, no consent kept", async () => {
    const tok = deferred<void>();
    N.getExpoPushTokenAsync.mockImplementationOnce(async () => {
      await tok.promise;
      return { type: "expo", data: TOKEN };
    });
    await openWallet();
    await press(R.enable);
    routes.set("POST /auth/logout", () => reply(200, {}));
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: user({ id: "user-2", email: "b@example.test" }),
        session: { accessToken: "access-user-2", refreshToken: "refresh-user-2-unique", expiresIn: 900 },
      }),
    );
    await act(async () => probeAuth.logout());
    await act(async () => { await probeAuth.verifyOTP("b@example.test", "challenge", "123456"); });
    await screen.findByTestId("inicio");
    await act(async () => tok.resolve());
    await settle();
    expect(callsTo(PUSH)).toHaveLength(0);
    expect(callsTo(REMOVE)).toHaveLength(0);
    expect(backing.has(CONSENT)).toBe(false);
    expect(backing.has(reminderConsentKey("user-2"))).toBe(false);
  });

  it("stale cached wallet: a claim that is now redeemed is not highlighted and no QR opens", async () => {
    await openWallet();
    expect(await walletView().findByText(COUPON_A)).toBeTruthy();
    wallet.claims = [claimRecord(CLAIM_1, COUPON_1, "redeemed")];
    await tap(CLAIM_1);
    await settle();
    unchanged();
    expect(walletView().queryByText(COPY.viewQr)).toBeNull();
  });

  it("tap for another account's claim leaves the wallet unchanged", async () => {
    await openWallet();
    const before = callsTo(CLAIMS_GET).length;
    await tap("0b111111-1111-4111-8111-111111111111");
    await settle();
    unchanged();
    expect(callsTo(CLAIMS_GET).length).toBe(before + 1);
    expect(walletView().getByText(COPY.viewQr)).toBeTruthy();
  });

  it("malformed / foreign events change nothing: no nav, no read", async () => {
    await openSignedIn();
    const reads = callsTo(CLAIMS_GET).length;
    const bad: any[] = [
      { actionIdentifier: DEFAULT_ACTION, notification: { request: { identifier: "a", content: { data: null } } } },
      { actionIdentifier: DEFAULT_ACTION, notification: { request: { identifier: "b", content: { data: "str" } } } },
      { actionIdentifier: DEFAULT_ACTION, notification: { request: { identifier: "c", content: { data: { type: "coupon-expiry-reminder", claimId: 5 } } } } },
      { actionIdentifier: DEFAULT_ACTION, notification: { request: { identifier: "d", content: { data: { type: "coupon-expiry-reminder", claimId: CLAIM_1 + "x" } } } } },
      { actionIdentifier: "other", notification: { request: { identifier: "e", content: { data: { type: "coupon-expiry-reminder", claimId: CLAIM_1 } } } } },
      { actionIdentifier: DEFAULT_ACTION, notification: { request: { identifier: "f", content: { data: { type: "x", claimId: CLAIM_1 } } } } },
      { actionIdentifier: DEFAULT_ACTION, notification: { request: { identifier: "g", content: {} } } },
    ];
    for (const b of bad) {
      await act(async () => { for (const l of [...N.__state.listeners]) l(b); });
    }
    await settle();
    expect(visited).toEqual([]);
    expect(callsTo(CLAIMS_GET).length).toBe(reads);
  });

  it("tap while logged out then login of an account: wallet unchanged, no nav", async () => {
    render(<RemindersApp />);
    await screen.findByTestId("auth-area:/auth/welcome");
    await tap(CLAIM_1);
    await settle();
    seed();
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: user({ id: "user-1" }),
        session: { accessToken: "a1", refreshToken: "r1-unique-xx", expiresIn: 900 },
      }),
    );
    await act(async () => { await probeAuth.verifyOTP("a@example.test", "challenge", "123456"); });
    await settle();
    expect(visited).toEqual([]);
  });

  it("two different notifications for the same claim: wallet opened and resolved without QR, nav at most once per tap", async () => {
    await openSignedIn();
    await tap(CLAIM_1, { id: "n1" });
    await settle();
    await tap(CLAIM_1, { id: "n1" });
    await settle();
    expect(visited).toEqual(["/wallet"]);
    expect(await walletView().findByText(R.opened)).toBeTruthy();
    expect(walletView().queryByText(COPY.qrInstruction)).toBeNull();
  });

  it("restart with consent on but OS permission undetermined never prompts and does not PUT", async () => {
    backing.set(CONSENT, "on");
    N.__state.permission = "undetermined";
    await openWallet();
    await settle();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(callsTo(PUSH)).toHaveLength(0);
  });
});
