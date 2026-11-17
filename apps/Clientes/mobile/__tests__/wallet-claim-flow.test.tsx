import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

import { CLIENT_SESSION_STORAGE_KEY } from "@/src/features/auth/infrastructure/session-storage";

import {
  CLAIM_1,
  CLAIM_PATH,
  CLAIMS_GET,
  COPY,
  COUPON_1,
  COUPON_A,
  FEED,
  NEAR_A,
  PROFILE_GET,
  REISSUE,
  TOKEN_1,
  TOKEN_2,
  WalletApp,
  backing,
  calls,
  callsTo,
  claimRecord,
  decodeDrawnQr,
  deferred,
  feedItem,
  focusWallet,
  inicio,
  installWalletHarness,
  logged,
  mockNav,
  noOsCalls,
  openInicioWithWallet,
  probeAuth,
  profile,
  qrIsDrawn,
  qrKey,
  renderedText,
  reply,
  routes,
  seed,
  settle,
  user,
  visited,
  wallet,
  walletView,
} from "./wallet-test-utils";

installWalletHarness();

const REFRESH = "POST /auth/refresh";
const COPY_FOLLOWING = "Siguiendo";
const setItem = SecureStore.setItemAsync as jest.Mock;
const qrKeys = () =>
  [...backing.keys()].filter((k) => k.startsWith("savanhi-clientes-qr."));
const quiet = (ms = 200) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const claimButton = () => inicio().getByText(COPY.claim);
const noSecretAnywhere = (token: string) => {
  expect(renderedText()).not.toContain(token);
  expect(JSON.stringify(screen.toJSON())).not.toContain(token);
  expect(logged()).not.toContain(token);
  expect(calls.every((c) => !c.url.includes(token))).toBe(true);
};

describe("T2e.A claim from Inicio", () => {
  it("the first Inicio asks the OS for nothing, sends no lat/lng and offers «Reclamar»", async () => {
    await openInicioWithWallet();
    noOsCalls();
    expect(callsTo(FEED)).toHaveLength(1);
    expect(callsTo(FEED)[0]!.query.has("lat")).toBe(false);
    expect(callsTo(FEED)[0]!.query.has("lng")).toBe(false);
    expect(claimButton()).toBeTruthy();
    expect(callsTo(CLAIMS_GET)).toHaveLength(0);
  });

  it("a 201 stores the token at once and confirms in Inicio, with no automatic navigation", async () => {
    await openInicioWithWallet();
    fireEvent.press(claimButton());
    await inicio().findByText(COPY.claimed);

    expect(callsTo(CLAIM_PATH(COUPON_1))).toHaveLength(1);
    expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_1);
    expect(qrKeys()).toEqual([qrKey(CLAIM_1)]);
    // Only the session and this one token are ever persisted: no catalog.
    expect([...backing.keys()].sort()).toEqual(
      [CLIENT_SESSION_STORAGE_KEY, qrKey(CLAIM_1)].sort(),
    );
    expect(inicio().queryByText(COPY.claim)).toBeNull();
    expect(inicio().getByText(COPY.viewWallet)).toBeTruthy();
    expect(inicio().getByText(COPY_FOLLOWING)).toBeTruthy();
    expect(visited).toEqual([]);
    expect(mockNav.redirects).toEqual([]);
    noSecretAnywhere(TOKEN_1);
  });

  it("«Ver Billetera» is an explicit action that goes to the wallet tab", async () => {
    await openInicioWithWallet();
    fireEvent.press(claimButton());
    fireEvent.press(await inicio().findByText(COPY.viewWallet));
    expect(visited).toEqual(["/wallet"]);
  });

  it("a double tap sends one request", async () => {
    await openInicioWithWallet();
    const gate = deferred();
    routes.set(CLAIM_PATH(COUPON_1), () => gate.promise);
    act(() => {
      fireEvent.press(claimButton());
      fireEvent.press(claimButton());
    });
    await settle();
    expect(callsTo(CLAIM_PATH(COUPON_1))).toHaveLength(1);
    await act(async () => {
      gate.resolve(
        reply(201, {
          data: claimRecord(CLAIM_1, COUPON_1, "claimed", TOKEN_1),
        }),
      );
    });
    await inicio().findByText(COPY.claimed);
    expect(callsTo(CLAIM_PATH(COUPON_1))).toHaveLength(1);
    expect(qrKeys()).toEqual([qrKey(CLAIM_1)]);
  });

  it("claimed: true (a released coupon included) offers no claim and no wallet claim", async () => {
    wallet.claimedCoupons.add(COUPON_1);
    await openInicioWithWallet();
    expect(inicio().queryByText(COPY.claim)).toBeNull();
    expect(inicio().queryByText(COPY.claimed)).toBeNull();
    expect(inicio().queryByText(COPY.viewWallet)).toBeNull();
    expect(callsTo(CLAIM_PATH(COUPON_1))).toHaveLength(0);
    expect(callsTo(CLAIMS_GET)).toHaveLength(0);
  });

  it("a 502 shows the approved error, keeps the card claimable and re-reads the feed once", async () => {
    await openInicioWithWallet();
    routes.set(CLAIM_PATH(COUPON_1), () =>
      reply(502, { error: "Unable to create the claim." }),
    );
    fireEvent.press(claimButton());
    await inicio().findByText(COPY.claimError);
    await quiet();

    expect(callsTo(CLAIM_PATH(COUPON_1))).toHaveLength(1);
    expect(callsTo(FEED)).toHaveLength(2);
    expect(inicio().queryByText(COPY.claimed)).toBeNull();
    expect(qrKeys()).toEqual([]);
    expect(renderedText()).not.toContain("Unable to create");
    expect(claimButton()).toBeTruthy();
  });

  it("a network failure is an honest error with no automatic second claim", async () => {
    await openInicioWithWallet();
    routes.delete(CLAIM_PATH(COUPON_1));
    fireEvent.press(claimButton());
    await inicio().findByText(COPY.claimError);
    await quiet();

    expect(callsTo(CLAIM_PATH(COUPON_1))).toHaveLength(1);
    expect(callsTo(FEED)).toHaveLength(2);
    expect(inicio().queryByText(COPY.claimed)).toBeNull();
    expect(qrKeys()).toEqual([]);
  });

  it("a 409 re-reads the feed, which then says claimed, so the button goes away", async () => {
    await openInicioWithWallet();
    routes.set(CLAIM_PATH(COUPON_1), () => {
      wallet.claimedCoupons.add(COUPON_1);
      return reply(409, { error: "You have already claimed this coupon." });
    });
    fireEvent.press(claimButton());
    await inicio().findByText(COPY.claimError);
    await waitFor(() => expect(inicio().queryByText(COPY.claim)).toBeNull());
    expect(callsTo(CLAIM_PATH(COUPON_1))).toHaveLength(1);
    expect(inicio().queryByText(COPY.claimed)).toBeNull();
  });

  it("a 201 with no usable token is not a fake success and is reconciled by one re-read", async () => {
    await openInicioWithWallet();
    routes.set(CLAIM_PATH(COUPON_1), () => {
      wallet.claimedCoupons.add(COUPON_1);
      wallet.claims.unshift(claimRecord(CLAIM_1, COUPON_1, "claimed"));
      return reply(201, { data: claimRecord(CLAIM_1, COUPON_1, "claimed", null) });
    });
    fireEvent.press(claimButton());
    await inicio().findByText(COPY.claimError);
    await waitFor(() => expect(callsTo(FEED)).toHaveLength(2));

    expect(inicio().queryByText(COPY.claimed)).toBeNull();
    expect(qrKeys()).toEqual([]);
    expect(callsTo(CLAIM_PATH(COUPON_1))).toHaveLength(1);
  });

  it("a storage failure after a real claim is still a claim; a later «Ver QR» re-issues once", async () => {
    await openInicioWithWallet();
    setItem.mockRejectedValueOnce(new Error(`keystore full ${TOKEN_1}`));
    fireEvent.press(claimButton());
    await inicio().findByText(COPY.claimed);

    expect(inicio().queryByText(COPY.claimError)).toBeNull();
    expect(callsTo(CLAIM_PATH(COUPON_1))).toHaveLength(1);
    expect(qrKeys()).toEqual([]);
    noSecretAnywhere(TOKEN_1);

    await focusWallet();
    fireEvent.press(await walletView().findByText(COPY.viewQr));
    await walletView().findByText(COPY.qrInstruction);
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(1);
    expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_2);
    expect(decodeDrawnQr()).toBe(TOKEN_2);
    noSecretAnywhere(TOKEN_2);
  });

  it("an older feed read that still says claimed: false cannot re-enable «Reclamar»", async () => {
    await openInicioWithWallet();
    routes.set(FEED, () =>
      reply(200, {
        data: [feedItem(COUPON_1, COUPON_A, NEAR_A, true, false)],
      }),
    );
    fireEvent.press(claimButton());
    await inicio().findByText(COPY.claimed);
    await quiet();
    expect(inicio().queryByText(COPY.claim)).toBeNull();
    expect(inicio().getByText(COPY.claimed)).toBeTruthy();
    expect(callsTo(CLAIM_PATH(COUPON_1))).toHaveLength(1);
  });
});

describe("T2e.A claim: session and eligibility", () => {
  it("a 403 whose profile re-read says underage closes the gate once and confirms nothing", async () => {
    await openInicioWithWallet();
    routes.set(CLAIM_PATH(COUPON_1), () =>
      reply(403, { error: "x", details: { eligibility: "underage" } }),
    );
    routes.set(PROFILE_GET, () =>
      reply(200, {
        data: profile({ birthDate: "2015-01-01", eligibility: "underage" }),
      }),
    );
    fireEvent.press(claimButton());
    await screen.findByTestId("auth-area:/auth/profile");
    await quiet();
    expect(callsTo(CLAIM_PATH(COUPON_1))).toHaveLength(1);
    expect(screen.queryByText(COPY.claimed)).toBeNull();
    expect(qrKeys()).toEqual([]);
  });

  it("a terminal 401 clears the session, closes the gate and stores no token", async () => {
    await openInicioWithWallet();
    routes.set(CLAIM_PATH(COUPON_1), () => reply(401, {}));
    routes.set(REFRESH, () => reply(401, { error: "invalid refresh" }));
    fireEvent.press(claimButton());
    await screen.findByTestId("auth-area:/auth/welcome");
    expect(backing.has(CLIENT_SESSION_STORAGE_KEY)).toBe(false);
    expect(qrKeys()).toEqual([]);
    expect(screen.queryByText(COPY.claimed)).toBeNull();
  });

  it("a customer whose role is not client reaches no customer API at all", async () => {
    seed(user({ role: "tendero" }));
    render(<WalletApp />);
    await settle();
    await quiet();
    expect(screen.queryByTestId("inicio")).toBeNull();
    expect(callsTo(FEED)).toHaveLength(0);
    expect(callsTo(CLAIMS_GET)).toHaveLength(0);
    expect(calls.some((c) => c.key.startsWith("POST /api/v1/clientes"))).toBe(false);
  });

  it("a claim answer that arrives after logout stores nothing and confirms nothing", async () => {
    await openInicioWithWallet();
    const gate = deferred();
    routes.set(CLAIM_PATH(COUPON_1), () => gate.promise);
    fireEvent.press(claimButton());
    await settle();
    await act(async () => {
      await probeAuth.logout();
    });
    await act(async () => {
      gate.resolve(
        reply(201, {
          data: claimRecord(CLAIM_1, COUPON_1, "claimed", TOKEN_1),
        }),
      );
    });
    await quiet();

    expect(qrKeys()).toEqual([]);
    expect(backing.has(CLIENT_SESSION_STORAGE_KEY)).toBe(false);
    expect(screen.queryByText(COPY.claimed)).toBeNull();
    expect(logged()).not.toContain(TOKEN_1);
  });

  it("an old provider's late write and cleanup cannot erase the token a new provider re-issued", async () => {
    const first = await openInicioWithWallet();
    const gate = deferred<void>();
    setItem.mockImplementationOnce(async (key: string, value: string) => {
      await gate.promise;
      backing.set(key, value);
    });
    fireEvent.press(claimButton());
    await waitFor(() => expect(setItem).toHaveBeenCalled());
    // The first provider goes away while its keystore write is still open.
    first.unmount();

    render(<WalletApp />);
    await screen.findByTestId("inicio");
    await focusWallet();
    fireEvent.press(await walletView().findByText(COPY.viewQr));
    await settle();
    // The shared queue holds the newer work behind the older operation.
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(0);

    await act(async () => {
      gate.resolve();
    });
    await walletView().findByText(COPY.qrInstruction);

    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(1);
    expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_2);
    expect(decodeDrawnQr()).toBe(TOKEN_2);
    expect(setItem.mock.calls.map((c) => c[1]).filter((v) => v !== undefined)).toEqual(
      expect.arrayContaining([TOKEN_1, TOKEN_2]),
    );
    expect(logged()).not.toContain(TOKEN_1);
    expect(qrIsDrawn()).toBe(true);
  });
});
