// T2e.A public flows: the real AuthProvider, AuthGuard, DiscoveryProvider and
// WalletProvider with the real screens; mocks only at the edges (fetch, the
// SecureStore map, AppState, the router). Fake fixture tokens only.
import React from "react";
import { View } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import jsQR from "jsqr";
import type { CustomerClaim, CustomerClaimStatus } from "@repo/api-contracts";

import {
  appStateHandlers,
  backing,
  callsTo,
  COUPON_A,
  deferred,
  FEED,
  feedItem,
  inicio,
  installMapHarness,
  mockNav,
  NEAR_A,
  noOsCalls,
  Probe,
  probeAuth,
  renderedText,
  reply,
  routes,
  seed,
  settle,
  user,
} from "./discovery-map-test-utils";
import { AuthGuard } from "@/src/features/auth/presentation/AuthGuard";
import { AuthProvider } from "@/src/features/auth/presentation/AuthProvider";
import { DiscoveryProvider } from "@/src/features/discovery/presentation/DiscoveryProvider";
import InicioScreen from "@/src/features/discovery/presentation/InicioScreen";
import { buildQrDrawing } from "@/src/features/wallet/presentation/QrCode";
import { WalletProvider } from "@/src/features/wallet/presentation/WalletProvider";
import WalletScreen from "@/src/features/wallet/presentation/WalletScreen";

const { __FocusContext: FocusContext } = jest.requireMock("expo-router");

const COUPON_ID = "c1111111-1111-4111-8111-111111111111";
const CLAIM_ID = "d1111111-1111-4111-8111-111111111111";
const TOKEN_1 = "aB3-_xY9kLmN0pQrStUvWxYz1234567890AbCdEfGhI";
const TOKEN_2 = "Zz9_-yX8wVuT7sRqP6oNmL5kJiH4gFeD3cBa2A1b0Cd";
const TOKEN_3 = "Qq1-_Ww2EeRr3TtYy4UuIi5OoPp6AaSs7DdFf8GgHhJ";
const CLAIM_POST = `POST /api/v1/clientes/coupons/${COUPON_ID}/claims`;
const REISSUE_POST = `POST /api/v1/clientes/claims/${CLAIM_ID}/qr`;
const CLAIMS_GET = "GET /api/v1/clientes/claims";
const CLAIM_ERROR = "No pudimos reclamar el cupón. Intenta de nuevo";
const QR_LABEL = "Código QR del cupón";

const qrKey = (claimId: string, userId = "user-1") =>
  `savanhi-clientes-qr.${userId}.${claimId}`;
const setItem = SecureStore.setItemAsync as jest.Mock;
const logs = ["log", "info", "warn", "error", "debug"].map((method) =>
  jest.spyOn(console, method as "log").mockImplementation(() => {}),
);
const logged = () => JSON.stringify(logs.map((spy) => spy.mock.calls));

// ---- the real tabs, reduced to Inicio and Billetera over the real providers ----
const ui = { focus: (_focused: boolean) => {} };

function Tabs() {
  const [mounted, setMounted] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  ui.focus = (next) => {
    if (next) setMounted(true);
    setFocused(next);
  };
  return (
    <AuthGuard area="tabs">
      <DiscoveryProvider>
        <WalletProvider>
          <View testID="inicio">
            <FocusContext.Provider value={!focused}>
              <InicioScreen />
            </FocusContext.Provider>
          </View>
          {mounted ? (
            <View testID="billetera">
              <FocusContext.Provider value={focused}>
                <WalletScreen />
              </FocusContext.Provider>
            </View>
          ) : null}
        </WalletProvider>
      </DiscoveryProvider>
    </AuthGuard>
  );
}

const visited: string[] = [];

function App() {
  const [path, setPath] = React.useState("/");
  mockNav.go = (href: string) => {
    if (href.startsWith("/auth")) setPath(href);
    else {
      visited.push(href);
      setPath("/");
    }
  };
  mockNav.path = path;
  return (
    <AuthProvider>
      <Probe />
      {path === "/" ? (
        <Tabs />
      ) : (
        <AuthGuard area="auth">
          <View testID="auth-area" />
        </AuthGuard>
      )}
    </AuthProvider>
  );
}

const wallet = () => within(screen.getByTestId("billetera"));
const claimRecord = (
  id: string,
  status: CustomerClaimStatus = "claimed",
  qrToken: string | null = null,
): CustomerClaim => ({
  id,
  status,
  qrToken,
  claimedOn: "2026-11-10",
  redeemedOn: null,
  coupon: feedItem(COUPON_ID, COUPON_A, NEAR_A, false, false).coupon,
  store: { id: NEAR_A.id, name: NEAR_A.name },
});
const focusWallet = async () => {
  await act(async () => {
    ui.focus(true);
  });
  await settle();
};
const goToBackground = () =>
  act(async () => {
    appStateHandlers.forEach((handler) => handler("background"));
  });
const qrKeys = () =>
  [...backing.keys()].filter((k) => k.startsWith("savanhi-clientes-qr."));

type Server = {
  claimed: boolean;
  claims: CustomerClaim[];
  tokens: string[];
};

function serve(
  claimOutcome?: (server: Server) => ReturnType<typeof reply>,
): Server {
  const server: Server = {
    claimed: false,
    claims: [],
    tokens: [TOKEN_1, TOKEN_2, TOKEN_3],
  };
  const baseFeed = routes.get(FEED)!;
  routes.set(FEED, (call) => {
    const answer = baseFeed(call) as ReturnType<typeof reply>;
    return {
      ...answer,
      json: async () => {
        const body = (await answer.json()) as {
          data: Array<{ coupon: { id: string } }>;
        };
        return {
          data: body.data.map((item) => ({
            ...item,
            claimed: server.claimed && item.coupon.id === COUPON_ID,
          })),
        };
      },
    };
  });
  routes.set(CLAIM_POST, () => {
    if (claimOutcome) return claimOutcome(server);
    server.claimed = true;
    server.claims = [claimRecord(CLAIM_ID)];
    return reply(201, {
      data: claimRecord(CLAIM_ID, "claimed", server.tokens.shift()!),
    });
  });
  routes.set(CLAIMS_GET, () =>
    reply(200, {
      data: server.claims.map((claim) => ({ ...claim, qrToken: null })),
    }),
  );
  routes.set(REISSUE_POST, () =>
    reply(200, {
      data: claimRecord(CLAIM_ID, "claimed", server.tokens.shift()!),
    }),
  );
  return server;
}

installMapHarness();
beforeEach(() => {
  logs.forEach((spy) => spy.mockClear());
  visited.length = 0;
  setItem.mockClear();
});

async function open() {
  seed();
  render(<App />);
  await screen.findByTestId("inicio");
  await inicio().findByText(COUPON_A);
}

describe("T2e.A public flows", () => {
  it("a 201 stores the token, confirms in place, navigates nowhere and asks the OS for nothing", async () => {
    serve();
    await open();
    noOsCalls();
    expect(callsTo(FEED)[0]!.query.has("lat")).toBe(false);

    fireEvent.press(inicio().getByText("Reclamar"));
    await inicio().findByText("Cupón reclamado");
    expect(inicio().getByText("Ver Billetera")).toBeTruthy();
    expect(inicio().queryByText("Reclamar")).toBeNull();
    expect(visited).toEqual([]);
    expect(backing.get(qrKey(CLAIM_ID))).toBe(TOKEN_1);
    expect(renderedText()).not.toContain(TOKEN_1);
    expect(logged()).not.toContain(TOKEN_1);
    noOsCalls();
  });

  it("a double tap in the same tick sends one POST and a stale read never brings the button back", async () => {
    serve();
    await open();
    const button = inicio().getByText("Reclamar");
    fireEvent.press(button);
    fireEvent.press(button);
    await inicio().findByText("Cupón reclamado");
    expect(callsTo(CLAIM_POST)).toHaveLength(1);
    await settle();
    expect(inicio().queryByText("Reclamar")).toBeNull();
  });

  it("a lost 201 answer shows the error, repeats nothing, re-reads the feed, and «Ver QR» re-issues once", async () => {
    serve((state) => {
      state.claimed = true;
      state.claims = [claimRecord(CLAIM_ID)];
      throw new Error("offline");
    });
    await open();
    const feedBefore = callsTo(FEED).length;

    fireEvent.press(inicio().getByText("Reclamar"));
    await inicio().findByText(CLAIM_ERROR);
    await settle();
    await settle();
    expect(callsTo(CLAIM_POST)).toHaveLength(1);
    expect(callsTo(FEED).length).toBeGreaterThan(feedBefore);
    expect(qrKeys()).toEqual([]);
    expect(inicio().queryByText("Reclamar")).toBeNull();

    await focusWallet();
    fireEvent.press(await wallet().findByText("Ver QR"));
    // The lost answer consumed no token, so the re-issue hands out the first one.
    await waitFor(() => expect(backing.get(qrKey(CLAIM_ID))).toBe(TOKEN_1));
    expect(callsTo(REISSUE_POST)).toHaveLength(1);
  });

  it("a keystore write that fails after a real 201 is still a claim, and «Ver QR» re-issues once", async () => {
    serve();
    await open();
    setItem.mockImplementationOnce(async () => {
      throw new Error("keystore");
    });
    fireEvent.press(inicio().getByText("Reclamar"));
    await inicio().findByText("Cupón reclamado");
    expect(inicio().queryByText(CLAIM_ERROR)).toBeNull();
    expect(qrKeys()).toEqual([]);

    await focusWallet();
    fireEvent.press(await wallet().findByText("Ver QR"));
    await waitFor(() => expect(screen.getByLabelText(QR_LABEL)).toBeTruthy());
    expect(callsTo(REISSUE_POST)).toHaveLength(1);
  });

  it("with a stored token, reopening and refocusing «Ver QR» makes no re-issue request", async () => {
    serve();
    await open();
    fireEvent.press(inicio().getByText("Reclamar"));
    await inicio().findByText("Cupón reclamado");
    await focusWallet();

    fireEvent.press(await wallet().findByText("Ver QR"));
    await screen.findByLabelText(QR_LABEL);
    fireEvent.press(screen.getByText("Cerrar"));
    await settle();
    fireEvent.press(wallet().getByText("Ver QR"));
    await screen.findByLabelText(QR_LABEL);
    await act(async () => {
      ui.focus(false);
    });
    await focusWallet();
    expect(callsTo(REISSUE_POST)).toHaveLength(0);
  });

  it("a re-issue that answers after the app went to the background shows nothing", async () => {
    const server = serve();
    await open();
    // The wallet lists the claim, but this device holds no token for it.
    server.claimed = true;
    server.claims = [claimRecord(CLAIM_ID)];
    await focusWallet();
    const gate = deferred();
    routes.set(REISSUE_POST, () => gate.promise);

    fireEvent.press(await wallet().findByText("Ver QR"));
    await screen.findByText("Preparando tu código…");
    await goToBackground();
    expect(screen.queryByText("Preparando tu código…")).toBeNull();
    await act(async () => {
      gate.resolve(
        reply(200, { data: claimRecord(CLAIM_ID, "claimed", TOKEN_2) }),
      );
    });
    await settle();
    await settle();
    expect(screen.queryByLabelText(QR_LABEL)).toBeNull();
    expect(renderedText()).not.toContain(TOKEN_2);
    expect(logged()).not.toContain(TOKEN_2);
  });

  it("a keystore write that crosses logout and a same-user relogin cannot erase the newer re-issued token", async () => {
    const server = serve();
    await open();
    const gate = deferred<void>();
    setItem.mockImplementationOnce(async (key: string, value: string) => {
      await gate.promise;
      backing.set(key, value);
    });
    routes.set("POST /auth/logout", () => reply(200, {}));
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: user(),
        session: {
          accessToken: "relogin-access",
          refreshToken: "relogin-refresh-unique",
          expiresIn: 900,
        },
      }),
    );

    fireEvent.press(inicio().getByText("Reclamar"));
    await waitFor(() => expect(setItem).toHaveBeenCalled());
    await act(async () => {
      await probeAuth.logout();
    });
    await screen.findByTestId("auth-area");
    await act(async () => {
      await probeAuth.verifyOTP("cliente@example.test", "challenge", "123456");
    });
    await screen.findByTestId("inicio");
    // The server already has the claim; the new session re-issues explicitly.
    server.claims = [claimRecord(CLAIM_ID)];
    server.claimed = true;
    await focusWallet();
    fireEvent.press(await wallet().findByText("Ver QR"));
    // The old write finishes late.
    await act(async () => {
      gate.resolve();
    });
    await waitFor(() => expect(screen.queryByLabelText(QR_LABEL)).toBeTruthy());
    await settle();

    const stored = backing.get(qrKey(CLAIM_ID));
    expect(stored).toBe(TOKEN_2);
    expect(stored).not.toBe(TOKEN_1);
    expect(logged()).not.toContain(TOKEN_1);
    expect(logged()).not.toContain(TOKEN_2);
  });

  it("a late 201 after logout and a login as a DIFFERENT user leaves no key and no confirmation", async () => {
    serve();
    await open();
    const gate = deferred();
    routes.set(CLAIM_POST, () => gate.promise);
    routes.set("POST /auth/logout", () => reply(200, {}));
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: user({ id: "user-2", email: "b@example.test" }),
        session: {
          accessToken: "b-access",
          refreshToken: "b-refresh-unique",
          expiresIn: 900,
        },
      }),
    );

    fireEvent.press(inicio().getByText("Reclamar"));
    await settle();
    await act(async () => {
      await probeAuth.logout();
    });
    await act(async () => {
      await probeAuth.verifyOTP("b@example.test", "challenge", "123456");
    });
    await screen.findByTestId("inicio");
    await act(async () => {
      gate.resolve(
        reply(201, { data: claimRecord(CLAIM_ID, "claimed", TOKEN_1) }),
      );
    });
    await settle();
    await settle();
    expect(qrKeys()).toEqual([]);
    expect(screen.queryByText("Cupón reclamado")).toBeNull();
  });

  it("a 403 eligibility answer on the wallet read re-closes the gate without a loop", async () => {
    serve();
    await open();
    routes.set(CLAIMS_GET, () =>
      reply(403, {
        error: "x",
        details: { eligibility: "birth_date_required" },
      }),
    );
    await act(async () => {
      ui.focus(true);
    });
    await settle();
    await settle();
    expect(callsTo(CLAIMS_GET)).toHaveLength(1);
    expect(screen.queryByTestId("billetera")).toBeNull();
  });

  it("the production QR drawing decodes to the exact raw token, with a quiet zone of four modules", () => {
    for (const token of [TOKEN_1, TOKEN_2, TOKEN_3]) {
      const drawing = buildQrDrawing(token)!;
      const scale = 6;
      const width = drawing.side * scale;
      const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = 0;
      let maxY = 0;
      for (const run of drawing.d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
        const [x, y, length] = [Number(run[1]), Number(run[2]), Number(run[3])];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + length);
        maxY = Math.max(maxY, y + 1);
        for (let row = y * scale; row < (y + 1) * scale; row += 1) {
          for (let column = x * scale; column < (x + length) * scale; column += 1) {
            const at = (row * width + column) * 4;
            pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
          }
        }
      }
      expect(jsQR(pixels, width, width)?.data).toBe(token);
      expect(minX).toBeGreaterThanOrEqual(4);
      expect(minY).toBeGreaterThanOrEqual(4);
      expect(drawing.side - maxX).toBeGreaterThanOrEqual(4);
      expect(drawing.side - maxY).toBeGreaterThanOrEqual(4);
      expect(drawing.d).not.toContain(token);
    }
    expect(buildQrDrawing(`https://x.test/${TOKEN_1}`)).toBeNull();
    expect(buildQrDrawing("short")).toBeNull();
  });

  it("the wallet shows the four statuses in the server's order, «Ver QR» and «Devolver» only on «Disponible»", async () => {
    const server = serve();
    await open();
    server.claims = [
      claimRecord("d1", "claimed"),
      claimRecord("d2", "redeemed"),
      claimRecord("d3", "expired"),
      claimRecord("d4", "released"),
    ];
    await focusWallet();
    for (const label of ["Disponible", "Canjeado", "Vencido", "Devuelto"]) {
      expect(wallet().getByText(label)).toBeTruthy();
    }
    expect(wallet().getAllByText("Ver QR")).toHaveLength(1);
    expect(wallet().getAllByText("Devolver")).toHaveLength(1);
    expect(wallet().queryByText(/d1111|2026-11-10/)).toBeNull();
  });
});
