import React from "react";
import {
  act,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react-native";
import type { CustomerClaim } from "@repo/api-contracts";

import { CLIENT_SESSION_STORAGE_KEY } from "@/src/features/auth/infrastructure/session-storage";

import {
  CLAIM_1,
  CLAIM_2,
  CLAIM_3,
  CLAIM_4,
  CLAIMS_GET,
  COPY,
  COUPON_1,
  COUPON_2,
  PROFILE_GET,
  REISSUE,
  TOKEN_1,
  TOKEN_2,
  backing,
  blurWallet,
  calls,
  callsTo,
  claimRecord,
  decodeDrawnQr,
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
  wallet,
  walletView,
} from "./wallet-test-utils";

installWalletHarness();

const REFRESH = "POST /auth/refresh";
const quiet = (ms = 200) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const qrKeys = () =>
  [...backing.keys()].filter((k) => k.startsWith("savanhi-clientes-qr."));
const withValidTo = (claim: CustomerClaim, validTo: string): CustomerClaim => ({
  ...claim,
  coupon: { ...claim.coupon, validTo },
});

async function openWallet(claims: CustomerClaim[]) {
  wallet.claims = claims;
  await openInicioWithWallet();
  await focusWallet();
}
const ALL_FOUR = () => [
  claimRecord(CLAIM_1, COUPON_1, "claimed"),
  claimRecord(CLAIM_2, COUPON_2, "redeemed"),
  claimRecord(CLAIM_3, COUPON_1, "expired"),
  claimRecord(CLAIM_4, COUPON_2, "released"),
];
const pressViewQr = async () =>
  fireEvent.press(await walletView().findByText(COPY.viewQr));

describe("T2e.A Billetera: one list, four statuses", () => {
  it("shows the loading copy while the wallet is being read", async () => {
    const gate = deferred();
    routes.set(CLAIMS_GET, () => gate.promise);
    await openInicioWithWallet();
    await focusWallet();
    expect(walletView().getByText(COPY.walletLoading)).toBeTruthy();
    await act(async () => {
      gate.resolve(reply(200, { data: [] }));
    });
    await walletView().findByText(COPY.walletEmpty);
  });

  it("lists the four statuses in the server's order, newest first", async () => {
    await openWallet(ALL_FOUR());
    await walletView().findByText("Disponible");
    const text = renderedText();
    const order = ["Disponible", "Canjeado", "Vencido", "Devuelto"].map((s) =>
      text.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(callsTo(CLAIMS_GET)).toHaveLength(1);
  });

  it("offers «Ver QR» and «Devolver» only on the available claim", async () => {
    await openWallet(ALL_FOUR());
    await walletView().findByText("Disponible");
    expect(walletView().getAllByText(COPY.viewQr)).toHaveLength(1);
    expect(walletView().getAllByText("Devolver")).toHaveLength(1);
  });

  it("shows only coupon, validity dates and store: no id, no time, no secret", async () => {
    await openWallet(ALL_FOUR());
    await walletView().findByText("Disponible");
    const text = renderedText();
    expect(text).toContain("1 nov 2026 – 25 nov 2026");
    expect(text).toContain("Tienda Doña Rosa");
    for (const id of [CLAIM_1, CLAIM_2, CLAIM_3, CLAIM_4, COUPON_1]) {
      expect(text).not.toContain(id);
    }
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toContain("null");
  });

  it("takes the status from the server, never from the device date", async () => {
    await openWallet([
      withValidTo(claimRecord(CLAIM_1, COUPON_1, "claimed"), "2020-01-01"),
      claimRecord(CLAIM_2, COUPON_2, "expired"),
    ]);
    await walletView().findByText("Disponible");
    expect(walletView().getByText("Disponible")).toBeTruthy();
    expect(walletView().getByText("Vencido")).toBeTruthy();
    expect(walletView().getAllByText(COPY.viewQr)).toHaveLength(1);
  });

  it("shows the empty copy for a customer with no claims", async () => {
    await openWallet([]);
    expect(await walletView().findByText(COPY.walletEmpty)).toBeTruthy();
  });

  it("shows the approved load error with «Reintentar», then recovers explicitly", async () => {
    routes.set(CLAIMS_GET, () => reply(502, { error: "boom" }));
    await openInicioWithWallet();
    await focusWallet();
    await walletView().findByText(COPY.walletError);
    expect(renderedText()).not.toContain("boom");
    routes.set(CLAIMS_GET, () =>
      reply(200, { data: [claimRecord(CLAIM_1, COUPON_1, "claimed")] }),
    );
    fireEvent.press(walletView().getByText(COPY.retry));
    await walletView().findByText("Disponible");
    expect(callsTo(CLAIMS_GET)).toHaveLength(2);
  });

  it("re-reads on focus and on returning to the foreground, never by polling", async () => {
    await openWallet([claimRecord(CLAIM_1, COUPON_1, "claimed")]);
    await walletView().findByText("Disponible");
    expect(callsTo(CLAIMS_GET)).toHaveLength(1);
    await blurWallet();
    await focusWallet();
    expect(callsTo(CLAIMS_GET)).toHaveLength(2);
    await emitAppState("active");
    await settle();
    expect(callsTo(CLAIMS_GET)).toHaveLength(3);
    await quiet(300);
    expect(callsTo(CLAIMS_GET)).toHaveLength(3);
  });

  it("drops the stored token of a claim the server no longer calls available", async () => {
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    backing.set(qrKey(CLAIM_2), TOKEN_2);
    await openWallet([
      claimRecord(CLAIM_1, COUPON_1, "claimed"),
      claimRecord(CLAIM_2, COUPON_2, "redeemed"),
    ]);
    await waitFor(() => expect(backing.has(qrKey(CLAIM_2))).toBe(false));
    expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_1);
  });

  it("a 403 that the profile confirms closes the gate; a terminal 401 clears the session", async () => {
    routes.set(CLAIMS_GET, () =>
      reply(403, { error: "x", details: { eligibility: "underage" } }),
    );
    routes.set(PROFILE_GET, () =>
      reply(200, {
        data: profile({ birthDate: "2015-01-01", eligibility: "underage" }),
      }),
    );
    await openInicioWithWallet();
    await focusWallet();
    await screen.findByTestId("auth-area:/auth/profile");
    expect(callsTo(CLAIMS_GET)).toHaveLength(1);
  });

  it("a terminal 401 on the wallet read clears the session", async () => {
    routes.set(CLAIMS_GET, () => reply(401, {}));
    routes.set(REFRESH, () => reply(401, { error: "invalid refresh" }));
    await openInicioWithWallet();
    await focusWallet();
    await screen.findByTestId("auth-area:/auth/welcome");
    expect(backing.has(CLIENT_SESSION_STORAGE_KEY)).toBe(false);
  });
});

describe("T2e.A «Ver QR»", () => {
  it("shows a stored token with no request at all, and the code decodes to the token", async () => {
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    await openWallet([claimRecord(CLAIM_1, COUPON_1, "claimed")]);
    await pressViewQr();
    await walletView().findByText(COPY.qrInstruction);

    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(0);
    expect(decodeDrawnQr()).toBe(TOKEN_1);
    expect(renderedText()).not.toContain(TOKEN_1);
    expect(JSON.stringify(screen.toJSON())).not.toContain(TOKEN_1);
    expect(logged()).not.toContain(TOKEN_1);
    expect(calls.every((c) => !c.url.includes(TOKEN_1))).toBe(true);
  });

  it("with no stored token re-issues exactly once, stores the new token and never again", async () => {
    await openWallet([claimRecord(CLAIM_1, COUPON_1, "claimed")]);
    await pressViewQr();
    expect(await walletView().findByText(COPY.qrInstruction)).toBeTruthy();
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(1);
    expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_1);
    expect(decodeDrawnQr()).toBe(TOKEN_1);

    // Refocus while the code is visible, then close and reopen: still one call.
    await blurWallet();
    await focusWallet();
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(1);
    fireEvent.press(walletView().getByText(COPY.close));
    await waitFor(() =>
      expect(walletView().queryByText(COPY.qrInstruction)).toBeNull(),
    );
    await pressViewQr();
    await walletView().findByText(COPY.qrInstruction);
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(1);
    expect(decodeDrawnQr()).toBe(TOKEN_1);
  });

  it("shows the preparing copy while the re-issue is open", async () => {
    const gate = deferred();
    routes.set(REISSUE(CLAIM_1), () => gate.promise);
    await openWallet([claimRecord(CLAIM_1, COUPON_1, "claimed")]);
    await pressViewQr();
    await walletView().findByText(COPY.qrLoading);
    expect(qrIsDrawn()).toBe(false);
    await act(async () => {
      gate.resolve(
        reply(200, { data: claimRecord(CLAIM_1, COUPON_1, "claimed", TOKEN_1) }),
      );
    });
    await walletView().findByText(COPY.qrInstruction);
  });

  it("a failed re-issue is explicit, never retried by itself, and «Reintentar» is explicit", async () => {
    routes.set(REISSUE(CLAIM_1), () => reply(502, { error: "boom" }));
    await openWallet([claimRecord(CLAIM_1, COUPON_1, "claimed")]);
    await pressViewQr();
    await walletView().findByText(COPY.qrError);
    await quiet();
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(1);
    expect(qrIsDrawn()).toBe(false);
    expect(walletView().getByText(COPY.close)).toBeTruthy();
    expect(renderedText()).not.toContain("boom");

    routes.set(REISSUE(CLAIM_1), () =>
      reply(200, { data: claimRecord(CLAIM_1, COUPON_1, "claimed", TOKEN_1) }),
    );
    fireEvent.press(walletView().getByText(COPY.retry));
    await walletView().findByText(COPY.qrInstruction);
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(2);
    expect(decodeDrawnQr()).toBe(TOKEN_1);
  });

  it("a 409 closes the code, says the coupon is no longer available and re-reads the wallet", async () => {
    routes.set(REISSUE(CLAIM_1), () => {
      wallet.claims = [claimRecord(CLAIM_1, COUPON_1, "redeemed")];
      return reply(409, { error: "This claim has already been redeemed." });
    });
    await openWallet([claimRecord(CLAIM_1, COUPON_1, "claimed")]);
    await pressViewQr();
    await walletView().findByText(COPY.unavailable);
    await waitFor(() => expect(callsTo(CLAIMS_GET)).toHaveLength(2));
    await walletView().findByText("Canjeado");
    expect(qrIsDrawn()).toBe(false);
    expect(walletView().queryByText(COPY.qrInstruction)).toBeNull();
    expect(walletView().queryByText(COPY.viewQr)).toBeNull();
    expect(renderedText()).not.toContain("redeemed.");
  });

  it("clears the code on background and does not bring it back on return", async () => {
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    await openWallet([claimRecord(CLAIM_1, COUPON_1, "claimed")]);
    await pressViewQr();
    await walletView().findByText(COPY.qrInstruction);
    expect(qrIsDrawn()).toBe(true);

    await emitAppState("background");
    await waitFor(() =>
      expect(walletView().queryByText(COPY.qrInstruction)).toBeNull(),
    );
    expect(qrIsDrawn()).toBe(false);
    await emitAppState("active");
    await settle();
    expect(qrIsDrawn()).toBe(false);
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(0);
  });

  it("an answer that arrives after the app went to the background is never shown", async () => {
    const gate = deferred();
    routes.set(REISSUE(CLAIM_1), () => gate.promise);
    await openWallet([claimRecord(CLAIM_1, COUPON_1, "claimed")]);
    await pressViewQr();
    await walletView().findByText(COPY.qrLoading);
    await emitAppState("background");
    await act(async () => {
      gate.resolve(
        reply(200, { data: claimRecord(CLAIM_1, COUPON_1, "claimed", TOKEN_1) }),
      );
    });
    await quiet();
    expect(qrIsDrawn()).toBe(false);
    expect(walletView().queryByText(COPY.qrInstruction)).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain(TOKEN_1);
    // The token is kept for the same user: it is recoverable, never lost.
    expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_1);
  });

  it("closing the gate clears the code, keeps the user-scoped token and ignores a late re-issue", async () => {
    backing.set(qrKey(CLAIM_1), TOKEN_1);
    await openWallet([claimRecord(CLAIM_1, COUPON_1, "claimed")]);
    await pressViewQr();
    await walletView().findByText(COPY.qrInstruction);
    await act(async () => {
      await probeAuth.logout();
    });
    await screen.findByTestId("auth-area:/auth/welcome");
    expect(qrIsDrawn()).toBe(false);
    expect(JSON.stringify(screen.toJSON())).not.toContain(TOKEN_1);
    expect(backing.get(qrKey(CLAIM_1))).toBe(TOKEN_1);
  });

  it("a re-issue answer that arrives after logout writes nothing", async () => {
    const gate = deferred();
    routes.set(REISSUE(CLAIM_1), () => gate.promise);
    await openWallet([claimRecord(CLAIM_1, COUPON_1, "claimed")]);
    await pressViewQr();
    await walletView().findByText(COPY.qrLoading);
    await act(async () => {
      await probeAuth.logout();
    });
    await act(async () => {
      gate.resolve(
        reply(200, { data: claimRecord(CLAIM_1, COUPON_1, "claimed", TOKEN_2) }),
      );
    });
    await quiet();
    expect(qrKeys()).toEqual([]);
    expect(qrIsDrawn()).toBe(false);
    expect(logged()).not.toContain(TOKEN_2);
  });

  it("two quick taps on «Ver QR» make one re-issue", async () => {
    const gate = deferred();
    routes.set(REISSUE(CLAIM_1), () => gate.promise);
    await openWallet([claimRecord(CLAIM_1, COUPON_1, "claimed")]);
    const button = await walletView().findByText(COPY.viewQr);
    act(() => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    await settle();
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(1);
    await act(async () => {
      gate.resolve(
        reply(200, { data: claimRecord(CLAIM_1, COUPON_1, "claimed", TOKEN_1) }),
      );
    });
    await walletView().findByText(COPY.qrInstruction);
    expect(callsTo(REISSUE(CLAIM_1))).toHaveLength(1);
  });
});
