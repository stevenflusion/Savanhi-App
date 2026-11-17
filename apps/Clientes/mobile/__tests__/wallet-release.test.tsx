import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
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
  REISSUE,
  RELEASE,
  CLAIM_PATH,
  TOKEN_1,
  TOKEN_2,
  WalletApp,
  backing,
  calls,
  callsTo,
  claimRecord,
  decodeDrawnQr,
  deferred,
  emitAppState,
  focusWallet,
  inicio,
  installWalletHarness,
  logged,
  openInicioWithWallet,
  probeAuth,
  qrIsDrawn,
  qrKey,
  renderedText,
  reply,
  routes,
  seed,
  settle,
  user,
  wallet,
  walletView,
} from "./wallet-test-utils";

installWalletHarness();

const CONFIRM = "¿Devolver este cupón? No podrás volver a reclamarlo";
const RELEASE_ERROR = "No pudimos devolver el cupón. Intenta de nuevo";
const deleteItem = SecureStore.deleteItemAsync as jest.Mock;
const quiet = (ms = 200) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const qrKeys = () =>
  [...backing.keys()].filter((k) => k.startsWith("savanhi-clientes-qr."));
const snapshot = () => JSON.stringify([...backing.entries()]);
const pressRelease = async () =>
  fireEvent.press(await walletView().findByText(COPY.release));
const confirmButton = () => screen.getAllByText(COPY.release).at(-1)!;

async function openWallet(claims: CustomerClaim[] = [claimRecord(CLAIM_1, COUPON_1, "claimed")]) {
  wallet.claims = claims;
  for (const c of claims) wallet.claimedCoupons.add(c.coupon.id);
  await openInicioWithWallet();
  await focusWallet();
  await walletView().findByText("Disponible");
}

describe("T2e.B «Devolver»: the confirmation", () => {
  it("is offered only on «Disponible» and opening the confirmation sends and stores nothing", async () => {
    await openWallet([
      claimRecord(CLAIM_1, COUPON_1, "claimed"),
      claimRecord(CLAIM_2, COUPON_2, "redeemed"),
    ]);
    expect(walletView().getAllByText(COPY.release)).toHaveLength(1);
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    const before = { calls: calls.length, bytes: snapshot() };

    await pressRelease();
    expect(await screen.findByText(CONFIRM)).toBeTruthy();
    expect(screen.getByText(COPY.cancel)).toBeTruthy();
    expect(calls.length).toBe(before.calls);
    expect(snapshot()).toBe(before.bytes);
    expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(0);
  });

  it("«Cancelar» dismisses with «Devolución cancelada» and changes no request, byte or record", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    const before = {
      calls: calls.length,
      bytes: snapshot(),
      records: JSON.stringify(wallet.claims),
    };
    const deletes = deleteItem.mock.calls.length;

    await pressRelease();
    await screen.findByText(CONFIRM);
    fireEvent.press(screen.getByText(COPY.cancel));
    await waitFor(() => expect(screen.queryByText(CONFIRM)).toBeNull());

    expect(screen.getByText("Devolución cancelada")).toBeTruthy();
    expect(calls.length).toBe(before.calls);
    expect(snapshot()).toBe(before.bytes);
    expect(JSON.stringify(wallet.claims)).toBe(before.records);
    expect(deleteItem.mock.calls.length).toBe(deletes);
    expect(walletView().getByText("Disponible")).toBeTruthy();
    expect(walletView().getByText(COPY.release)).toBeTruthy();
  });
});

describe("T2e.B «Devolver»: confirmed return", () => {
  it("one confirmation sends exactly one POST (a double tap too), shows «Cupón devuelto» and «Devuelto»", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    const gate = deferred();
    routes.set(RELEASE(CLAIM_1), () => gate.promise);

    await pressRelease();
    await screen.findByText(CONFIRM);
    act(() => {
      fireEvent.press(confirmButton());
      fireEvent.press(confirmButton());
    });
    await settle();
    expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
    expect(callsTo(RELEASE(CLAIM_1))[0]!.url).toContain(`/claims/${CLAIM_1}/release`);

    await act(async () => {
      gate.resolve(
        reply(200, {
          data: { ...claimRecord(CLAIM_1, COUPON_1, "released"), qrToken: null },
        }),
      );
    });
    await screen.findByText("Cupón devuelto");
    await waitFor(() => expect(walletView().getByText("Devuelto")).toBeTruthy());
    expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
    expect(walletView().queryByText(COPY.release)).toBeNull();
    expect(walletView().queryByText(COPY.viewQr)).toBeNull();
    await waitFor(() => expect(backing.has(qrKey(CLAIM_1))).toBe(false));
  });

  it("re-reads the wallet and the shared feed once; the coupon stays claimed and can never be claimed again", async () => {
    await openWallet();
    const feedBefore = callsTo(FEED).length;
    const walletBefore = callsTo(CLAIMS_GET).length;

    await pressRelease();
    await screen.findByText(CONFIRM);
    fireEvent.press(confirmButton());
    await screen.findByText("Cupón devuelto");
    await quiet();

    expect(callsTo(FEED).length).toBe(feedBefore + 1);
    expect(callsTo(CLAIMS_GET).length).toBe(walletBefore + 1);
    expect(inicio().queryByText(COPY.claim)).toBeNull();
    expect(callsTo(CLAIM_PATH(COUPON_1))).toHaveLength(0);
  });

  it("a paused coupon or a deactivated store does not hide or block the return", async () => {
    const paused = claimRecord(CLAIM_1, COUPON_1, "claimed");
    await openWallet([{ ...paused, coupon: { ...paused.coupon, paused: true } }]);
    await pressRelease();
    await screen.findByText(CONFIRM);
    fireEvent.press(confirmButton());
    await screen.findByText("Cupón devuelto");
    expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
  });

  it("a key that cannot be removed is not a failed return and invites no second POST", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    deleteItem.mockRejectedValue(new Error(`keystore ${TOKEN_1}`));
    try {
      await pressRelease();
      await screen.findByText(CONFIRM);
      fireEvent.press(confirmButton());
      await screen.findByText("Cupón devuelto");
      await quiet();
      expect(screen.queryByText(RELEASE_ERROR)).toBeNull();
      expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
      expect(walletView().getByText("Devuelto")).toBeTruthy();
      expect(logged()).not.toContain(TOKEN_1);
    } finally {
      deleteItem.mockReset();
      deleteItem.mockImplementation(async (key: string) => {
        backing.delete(key);
      });
    }
  });

  it("an open QR for that claim closes, and no QR action or re-issue is offered while it is on its way", async () => {
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    await openWallet();
    const gate = deferred();
    routes.set(RELEASE(CLAIM_1), () => gate.promise);

    await pressRelease();
    await screen.findByText(CONFIRM);
    fireEvent.press(confirmButton());
    await settle();
    expect(walletView().queryByText(COPY.viewQr)).toBeNull();
    expect(walletView().queryByText(COPY.release)).toBeNull();
    expect(qrIsDrawn()).toBe(false);
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(0);

    await act(async () => {
      gate.resolve(
        reply(200, {
          data: { ...claimRecord(CLAIM_1, COUPON_1, "released"), qrToken: null },
        }),
      );
    });
    await screen.findByText("Cupón devuelto");
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(0);
  });

  it("a re-issue that answers after the return is never stored or shown", async () => {
    await openWallet();
    const gateQr = deferred();
    routes.set(REISSUE(CLAIM_1), () => gateQr.promise);

    fireEvent.press(await walletView().findByText(COPY.viewQr));
    await walletView().findByText(COPY.qrLoading);
    fireEvent.press(screen.getByText(COPY.close));
    await settle();
    await pressRelease();
    await screen.findByText(CONFIRM);
    fireEvent.press(confirmButton());
    await screen.findByText("Cupón devuelto");

    await act(async () => {
      gateQr.resolve(
        reply(200, { data: claimRecord(CLAIM_1, COUPON_1, "claimed", TOKEN_2) }),
      );
    });
    await quiet();
    expect(qrKeys()).toEqual([]);
    expect(qrIsDrawn()).toBe(false);
    expect(renderedText()).not.toContain(TOKEN_2);
    expect(logged()).not.toContain(TOKEN_2);
  });

  it("a wallet read that started before the return cannot bring «Disponible» back", async () => {
    await openWallet();
    const gate = deferred();
    routes.set(CLAIMS_GET, () => gate.promise);
    await emitAppState("active");
    await settle();

    await pressRelease();
    await screen.findByText(CONFIRM);
    routes.set(CLAIMS_GET, () =>
      reply(200, { data: wallet.claims.map((c) => ({ ...c, qrToken: null })) }),
    );
    fireEvent.press(confirmButton());
    await screen.findByText("Cupón devuelto");
    await act(async () => {
      gate.resolve(
        reply(200, {
          data: [claimRecord(CLAIM_1, COUPON_1, "claimed")],
        }),
      );
    });
    await quiet();
    expect(walletView().getByText("Devuelto")).toBeTruthy();
    expect(walletView().queryByText("Disponible")).toBeNull();
    expect(walletView().queryByText(COPY.release)).toBeNull();
  });
});

describe("T2e.B «Devolver»: refusals and failures", () => {
  it.each([409])(
    "a %s says the coupon is no longer available, re-reads the wallet and the feed, and never says «Cupón devuelto»",
    async (status) => {
      await openWallet();
      routes.set(RELEASE(CLAIM_1), () => {
        wallet.claims = [claimRecord(CLAIM_1, COUPON_1, "redeemed")];
        return reply(status, { error: "This claim has already been redeemed." });
      });
      const feedBefore = callsTo(FEED).length;

      await pressRelease();
      await screen.findByText(CONFIRM);
      fireEvent.press(confirmButton());
      await screen.findByText(COPY.unavailable);
      await waitFor(() => expect(walletView().getByText("Canjeado")).toBeTruthy());
      expect(screen.queryByText("Cupón devuelto")).toBeNull();
      expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
      expect(callsTo(FEED).length).toBe(feedBefore + 1);
      expect(renderedText()).not.toContain("already been redeemed");
    },
  );

  it.each([
    ["a 502", () => reply(502, { error: "boom" })],
    [
      "a 200 that is not a released claim",
      () => reply(200, { data: claimRecord(CLAIM_1, COUPON_1, "claimed") }),
    ],
  ])("%s shows the approved error, repeats nothing and needs a new confirmation", async (_l, answer) => {
    await openWallet();
    routes.set(RELEASE(CLAIM_1), answer);

    await pressRelease();
    await screen.findByText(CONFIRM);
    fireEvent.press(confirmButton());
    await screen.findByText(RELEASE_ERROR);
    await quiet();
    expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
    expect(screen.queryByText("Cupón devuelto")).toBeNull();
    expect(screen.queryByText(CONFIRM)).toBeNull();
    expect(walletView().getByText("Disponible")).toBeTruthy();
    expect(renderedText()).not.toContain("boom");

    routes.set(RELEASE(CLAIM_1), () => {
      wallet.claims = [claimRecord(CLAIM_1, COUPON_1, "released")];
      return reply(200, { data: claimRecord(CLAIM_1, COUPON_1, "released") });
    });
    await pressRelease();
    await screen.findByText(CONFIRM);
    expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
    fireEvent.press(confirmButton());
    await screen.findByText("Cupón devuelto");
    expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(2);
  });

  it("a network failure is the approved error with no automatic second request", async () => {
    await openWallet();
    routes.delete(RELEASE(CLAIM_1));
    await pressRelease();
    await screen.findByText(CONFIRM);
    fireEvent.press(confirmButton());
    await screen.findByText(RELEASE_ERROR);
    await quiet();
    expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
  });
});

describe("T2e.B «Devolver»: owner and session", () => {
  it("an answer that arrives after logout applies nothing and touches no key", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    const gate = deferred();
    routes.set(RELEASE(CLAIM_1), () => gate.promise);

    await pressRelease();
    await screen.findByText(CONFIRM);
    fireEvent.press(confirmButton());
    await settle();
    await act(async () => {
      await probeAuth.logout();
    });
    const feedAfter = callsTo(FEED).length;
    await act(async () => {
      gate.resolve(
        reply(200, {
          data: { ...claimRecord(CLAIM_1, COUPON_1, "released"), qrToken: null },
        }),
      );
    });
    await quiet();
    expect(screen.queryByText("Cupón devuelto")).toBeNull();
    expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_1);
    expect(callsTo(FEED).length).toBe(feedAfter);
  });

  it.each([
    ["the same user logging in again", {}],
    ["a different user", { id: "user-2", email: "b@example.test" }],
  ])("an old confirmation answering after %s never reaches the new session", async (_l, who) => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    const gate = deferred();
    routes.set(RELEASE(CLAIM_1), () => gate.promise);
    routes.set("POST /auth/logout", () => reply(200, {}));
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: user(who),
        session: {
          accessToken: "relogin-access",
          refreshToken: `relogin-refresh-${JSON.stringify(who).length}`,
          expiresIn: 900,
        },
      }),
    );

    await pressRelease();
    await screen.findByText(CONFIRM);
    fireEvent.press(confirmButton());
    await settle();
    await act(async () => {
      await probeAuth.logout();
    });
    await act(async () => {
      await probeAuth.verifyOTP("cliente@example.test", "challenge", "123456");
    });
    await screen.findByTestId("inicio");
    await act(async () => {
      gate.resolve(
        reply(200, {
          data: { ...claimRecord(CLAIM_1, COUPON_1, "released"), qrToken: null },
        }),
      );
    });
    await quiet();
    expect(screen.queryByText("Cupón devuelto")).toBeNull();
    expect(callsTo(RELEASE(CLAIM_1))).toHaveLength(1);
    expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_1);
  });

  it("no secret reaches text, logs or URLs during a return", async () => {
    await openWallet();
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    await pressRelease();
    await screen.findByText(CONFIRM);
    fireEvent.press(confirmButton());
    await screen.findByText("Cupón devuelto");
    await quiet();
    expect(renderedText()).not.toContain(TOKEN_1);
    expect(logged()).not.toContain(TOKEN_1);
    expect(calls.every((c) => !c.url.includes(TOKEN_1))).toBe(true);
    expect(decodeDrawnQr()).toBeNull();
  });
});
