// T2e.B regressions ported from the independent verifier's public probes. Real
// AuthProvider, AuthGuard, DiscoveryProvider and WalletProvider; the only
// mocks are the edges (fetch, the SecureStore map, AppState). Fake tokens only.
import { act, fireEvent, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import type { CustomerClaim } from "@repo/api-contracts";

import {
  CLAIM_1,
  CLAIM_2,
  CLAIMS_GET,
  COPY,
  COUPON_1,
  COUPON_2,
  FEED,
  PROFILE_GET,
  REISSUE,
  RELEASE,
  TOKEN_1,
  TOKEN_2,
  backing,
  calls,
  callsTo,
  claimRecord,
  deferred,
  emitAppState,
  focusWallet,
  installWalletHarness,
  logged,
  openInicioWithWallet,
  probeAuth,
  profile,
  qrIsDrawn,
  qrKey,
  renderedText,
  reply,
  routes,
  settle,
  user,
  wallet,
  walletView,
} from "./wallet-test-utils";

installWalletHarness();

const CONFIRM = "¿Devolver este cupón? No podrás volver a reclamarlo";
const RELEASE_ERROR = "No pudimos devolver el cupón. Intenta de nuevo";
const deleteItem = SecureStore.deleteItemAsync as jest.Mock;
const getItem = SecureStore.getItemAsync as jest.Mock;
const setItem = SecureStore.setItemAsync as jest.Mock;
const quiet = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 150));
  });
const snapshot = () => JSON.stringify([...backing.entries()]);
const releasedAnswer = (claimId: string, couponId: string) => ({
  data: { ...claimRecord(claimId, couponId, "released"), qrToken: null },
});

type Sent = { url: string; init: RequestInit };
let sent: Sent[] = [];

async function openWallet(
  claims: CustomerClaim[] = [claimRecord(CLAIM_1, COUPON_1, "claimed")],
) {
  wallet.claims = claims;
  for (const claim of claims) wallet.claimedCoupons.add(claim.coupon.id);
  await openInicioWithWallet();
  // Record what is really sent (method, headers, body) from here on.
  const inner = (global as { fetch: unknown }).fetch as jest.Mock;
  sent = [];
  (global as { fetch: unknown }).fetch = jest.fn(
    async (url: string, init: RequestInit = {}) => {
      sent.push({ url, init });
      return inner(url, init);
    },
  );
  await focusWallet();
  await walletView().findAllByText("Disponible");
}

const askRelease = async () => {
  fireEvent.press(await walletView().findByText(COPY.release));
  await screen.findByText(CONFIRM);
};
const confirm = () => fireEvent.press(screen.getAllByText(COPY.release).at(-1)!);
const confirmAndWait = async () => {
  confirm();
  await settle();
  await quiet();
};

describe("T2e.B «Devolver» regressions", () => {
  it("the POST has no body and no user id, carries only the Authorization header, and refreshes the wallet and the feed once", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    await askRelease();
    const walletBefore = callsTo(CLAIMS_GET).length;
    const feedBefore = callsTo(FEED).length;

    await confirmAndWait();

    const release = sent.filter((s) => s.url.endsWith(`/claims/${CLAIM_1}/release`));
    expect(release).toHaveLength(1);
    expect(release[0]!.init.method).toBe("POST");
    expect(release[0]!.init.body).toBeUndefined();
    expect(Object.keys(release[0]!.init.headers as object)).toEqual(["Authorization"]);
    expect(callsTo(CLAIMS_GET).length - walletBefore).toBe(1);
    expect(callsTo(FEED).length - feedBefore).toBe(1);
    expect(screen.getByText("Cupón devuelto")).toBeTruthy();
    expect(walletView().getByText("Devuelto")).toBeTruthy();
    expect(walletView().queryByText(COPY.viewQr)).toBeNull();
    expect(walletView().queryByText(COPY.release)).toBeNull();
    expect(backing.has(qrKey(CLAIM_1))).toBe(false);
  });

  it("a 409 shows the unavailable copy with no fake success, one bounded refresh, and keeps the key", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    routes.set(RELEASE(CLAIM_1), () =>
      reply(409, { error: "This claim was already released." }),
    );
    await askRelease();
    const walletBefore = callsTo(CLAIMS_GET).length;
    const feedBefore = callsTo(FEED).length;

    await confirmAndWait();

    expect(screen.getByText(COPY.unavailable)).toBeTruthy();
    expect(screen.queryByText("Cupón devuelto")).toBeNull();
    expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
    expect(callsTo(CLAIMS_GET).length - walletBefore).toBe(1);
    expect(callsTo(FEED).length - feedBefore).toBe(1);
    expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_1);
  });

  it.each([[500], [404]])(
    "a %i is the generic error with no automatic retry or refresh, the key untouched, and a new confirmation for the next try",
    async (status) => {
      await openWallet();
      backing.set(qrKey(CLAIM_1), TOKEN_1);
      routes.set(RELEASE(CLAIM_1), () => reply(status, { error: "x" }));
      await askRelease();
      const walletBefore = callsTo(CLAIMS_GET).length;
      const feedBefore = callsTo(FEED).length;

      await confirmAndWait();

      expect(screen.getByText(RELEASE_ERROR)).toBeTruthy();
      expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
      expect(callsTo(CLAIMS_GET).length).toBe(walletBefore);
      expect(callsTo(FEED).length).toBe(feedBefore);
      expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_1);
      expect(walletView().getByText("Disponible")).toBeTruthy();

      await askRelease();
      await confirmAndWait();
      expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(2);
    },
  );

  it("a 403 the profile confirms closes the gate once, sends nothing more and leaks no outcome", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    routes.set(RELEASE(CLAIM_1), () =>
      reply(403, { error: "x", details: { eligibility: "underage" } }),
    );
    routes.set(PROFILE_GET, () =>
      reply(200, {
        data: profile({ birthDate: "2015-01-01", eligibility: "underage" }),
      }),
    );
    await askRelease();

    await confirmAndWait();

    await screen.findByTestId("auth-area:/auth/profile");
    expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
    expect(screen.queryByText("Cupón devuelto")).toBeNull();
    expect(screen.queryByText(RELEASE_ERROR)).toBeNull();
    expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_1);
  });

  it.each([
    ["a claim that is still claimed", { data: claimRecord(CLAIM_1, COUPON_1, "claimed") }],
    ["another claim", { data: { ...claimRecord(CLAIM_2, COUPON_1, "released"), qrToken: null } }],
    ["a released claim that still carries a token", { data: { ...claimRecord(CLAIM_1, COUPON_1, "released"), qrToken: TOKEN_2 } }],
  ])("a 200 with %s is a failure and keeps the key", async (_label, body) => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    routes.set(RELEASE(CLAIM_1), () => reply(200, body));
    await askRelease();

    await confirmAndWait();

    expect(screen.getByText(RELEASE_ERROR)).toBeTruthy();
    expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_1);
    expect(screen.queryByText("Cupón devuelto")).toBeNull();
    expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
  });

  it("a key that cannot be removed still reads «Cupón devuelto» with one POST, and a later read retries the cleanup", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    deleteItem.mockImplementation(async () => {
      throw new Error("keystore down");
    });
    try {
      await askRelease();
      await confirmAndWait();
      expect(screen.getByText("Cupón devuelto")).toBeTruthy();
      expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);

      const deletesBefore = deleteItem.mock.calls.length;
      await emitAppState("active");
      await settle();
      await quiet();
      expect(deleteItem.mock.calls.length).toBeGreaterThan(deletesBefore);
      expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
    } finally {
      deleteItem.mockImplementation(async (key: string) => {
        backing.delete(key);
      });
    }
  });

  it("a wallet read that started before the return cannot restore «Disponible», now or on later stale reads", async () => {
    await openWallet();
    const gate = deferred();
    const normal = routes.get(CLAIMS_GET)!;
    routes.set(CLAIMS_GET, () => gate.promise);
    await emitAppState("active");
    await settle(); // the old read is in flight
    routes.set(CLAIMS_GET, normal);

    await askRelease();
    await confirmAndWait();
    expect(walletView().getByText("Devuelto")).toBeTruthy();

    await act(async () => {
      gate.resolve(
        reply(200, { data: [claimRecord(CLAIM_1, COUPON_1, "claimed")] }),
      );
    });
    await quiet();
    expect(walletView().getByText("Devuelto")).toBeTruthy();
    expect(walletView().queryByText(COPY.release)).toBeNull();

    // The server keeps answering with the old status for later reads.
    routes.set(CLAIMS_GET, () =>
      reply(200, { data: [claimRecord(CLAIM_1, COUPON_1, "claimed")] }),
    );
    await emitAppState("active");
    await settle();
    await quiet();
    expect(walletView().getByText("Devuelto")).toBeTruthy();
  });

  it("a keystore read pending when the return is confirmed shows no QR and no token", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    const gate = deferred<string | null>();
    getItem.mockImplementationOnce(() => gate.promise);
    fireEvent.press(await walletView().findByText(COPY.viewQr));
    await settle();

    await askRelease();
    await confirmAndWait();
    await act(async () => {
      gate.resolve(TOKEN_1);
    });
    await quiet();

    expect(qrIsDrawn()).toBe(false);
    expect(renderedText()).not.toContain(TOKEN_1);
    expect(backing.has(qrKey(CLAIM_1))).toBe(false);
  });

  it("a re-issue pending when the return is confirmed shows nothing and stores nothing", async () => {
    await openWallet(); // no stored token
    const gate = deferred();
    routes.set(REISSUE(CLAIM_1), () => gate.promise);
    fireEvent.press(await walletView().findByText(COPY.viewQr));
    await settle();

    await askRelease();
    await confirmAndWait();
    expect(screen.getByText("Cupón devuelto")).toBeTruthy();
    setItem.mockClear();
    await act(async () => {
      gate.resolve(
        reply(200, {
          data: { ...claimRecord(CLAIM_1, COUPON_1, "claimed"), qrToken: TOKEN_2 },
        }),
      );
    });
    await quiet();

    expect(qrIsDrawn()).toBe(false);
    expect(renderedText()).not.toContain(TOKEN_2);
    expect(backing.has(qrKey(CLAIM_1))).toBe(false);
  });

  it("a keystore write still open when the return is confirmed leaves no token behind", async () => {
    await openWallet();
    routes.set(REISSUE(CLAIM_1), () =>
      reply(200, {
        data: { ...claimRecord(CLAIM_1, COUPON_1, "claimed"), qrToken: TOKEN_2 },
      }),
    );
    const gate = deferred<void>();
    setItem.mockImplementationOnce(async (key: string, value: string) => {
      await gate.promise;
      backing.set(key, value);
    });
    fireEvent.press(await walletView().findByText(COPY.viewQr));
    await settle();
    await quiet();

    await askRelease();
    await confirmAndWait();
    await act(async () => {
      gate.resolve();
    });
    await quiet();

    expect(backing.has(qrKey(CLAIM_1))).toBe(false);
    expect(qrIsDrawn()).toBe(false);
    expect(renderedText()).not.toContain(TOKEN_2);
  });

  it("«Cancelar» sends no request, makes no keystore call, changes no byte and only shows the notice", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    await askRelease();
    const before = {
      calls: calls.length,
      bytes: snapshot(),
      gets: getItem.mock.calls.length,
      sets: setItem.mock.calls.length,
      deletes: deleteItem.mock.calls.length,
    };

    fireEvent.press(screen.getByText(COPY.cancel));
    await settle();
    await quiet();

    expect(screen.getByText("Devolución cancelada")).toBeTruthy();
    expect(calls.length).toBe(before.calls);
    expect(snapshot()).toBe(before.bytes);
    expect(getItem.mock.calls.length).toBe(before.gets);
    expect(setItem.mock.calls.length).toBe(before.sets);
    expect(deleteItem.mock.calls.length).toBe(before.deletes);
  });

  it("a return confirmed before logout never deletes or overwrites a key of the user who logs in next", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    const gate = deferred();
    routes.set(RELEASE(CLAIM_1), () => gate.promise);
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
    await askRelease();
    confirm();
    await settle();
    await act(async () => {
      await probeAuth.logout();
    });
    await act(async () => {
      await probeAuth.verifyOTP("b@example.test", "challenge", "123456");
    });
    await screen.findByTestId("inicio");
    backing.set(qrKey(CLAIM_1, "user-2"), TOKEN_2);
    const posts = callsTo(RELEASE(CLAIM_1)).length;
    const deletes = deleteItem.mock.calls.length;
    const sets = setItem.mock.calls.length;

    await act(async () => {
      gate.resolve(reply(200, releasedAnswer(CLAIM_1, COUPON_1)));
    });
    await quiet();

    expect(backing.get(qrKey(CLAIM_1, "user-2"))).toBe(TOKEN_2);
    expect(deleteItem.mock.calls.length).toBe(deletes);
    expect(setItem.mock.calls.length).toBe(sets);
    expect(callsTo(RELEASE(CLAIM_1)).length).toBe(posts);
    expect(screen.queryByText("Cupón devuelto")).toBeNull();
  });

  it("no token reaches text, logs or URLs during a full return", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    await askRelease();
    await confirmAndWait();
    expect(renderedText()).not.toContain(TOKEN_1);
    expect(logged()).not.toContain(TOKEN_1);
    expect(calls.every((c) => !c.url.includes(TOKEN_1))).toBe(true);
  });

  it("a paused coupon does not block the return", async () => {
    const claim = claimRecord(CLAIM_1, COUPON_1, "claimed");
    await openWallet([{ ...claim, coupon: { ...claim.coupon, paused: true } }]);
    await askRelease();
    await confirmAndWait();
    expect(screen.getByText("Cupón devuelto")).toBeTruthy();
  });

  it("returning one claim leaves the other claim's key and actions", async () => {
    await openWallet([
      claimRecord(CLAIM_1, COUPON_1, "claimed"),
      claimRecord(CLAIM_2, COUPON_2, "claimed"),
    ]);
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    backing.set(qrKey(CLAIM_2), TOKEN_2);

    fireEvent.press((await walletView().findAllByText(COPY.release))[0]!);
    await screen.findByText(CONFIRM);
    await confirmAndWait();

    expect(
      callsTo(RELEASE(CLAIM_1)).length + callsTo(RELEASE(CLAIM_2)).length,
    ).toBe(1);
    expect([CLAIM_1, CLAIM_2].filter((id) => backing.has(qrKey(id)))).toHaveLength(1);
    expect(walletView().getAllByText(COPY.viewQr)).toHaveLength(1);
    expect(walletView().getAllByText("Devuelto")).toHaveLength(1);
  });
});
