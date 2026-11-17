// The harness module registers the jest.mock calls, so it must load first.
import {
  appStateHandlers,
  COPY as MAP_COPY,
  COUPON_A,
  FEED,
  NEAR_A,
  NEAR_B,
  Probe,
  STORE_A,
  backing,
  calls,
  feedItem,
  inicio as inicioView,
  installMapHarness,
  mockNav,
  reply,
  routes,
  seed,
  server,
  settle,
} from "./discovery-map-test-utils";
export * from "./discovery-map-test-utils";

import React from "react";
import { View } from "react-native";
import { act, render, screen, within } from "@testing-library/react-native";
import jsQR from "jsqr";
import type { CustomerClaim, CustomerClaimStatus } from "@repo/api-contracts";

import { AuthGuard } from "@/src/features/auth/presentation/AuthGuard";
import { AuthProvider } from "@/src/features/auth/presentation/AuthProvider";
import { DiscoveryProvider } from "@/src/features/discovery/presentation/DiscoveryProvider";
import InicioScreen from "@/src/features/discovery/presentation/InicioScreen";
import { WalletProvider } from "@/src/features/wallet/presentation/WalletProvider";
import WalletScreen from "@/src/features/wallet/presentation/WalletScreen";


const { __FocusContext: FocusContext } = jest.requireMock("expo-router");

// ---- fixtures: fake opaque tokens only, never a real value --------------------
export const COUPON_1 = "c1111111-1111-4111-8111-111111111111";
export const COUPON_2 = "c2222222-2222-4222-8222-222222222222";
export const CLAIM_1 = "d1111111-1111-4111-8111-111111111111";
export const CLAIM_2 = "d2222222-2222-4222-8222-222222222222";
export const CLAIM_3 = "d3333333-3333-4333-8333-333333333333";
export const CLAIM_4 = "d4444444-4444-4444-8444-444444444444";
/** 43 base64url characters, mixed case, with `-` and `_`. */
export const TOKEN_1 = "aB3-_xY9kLmN0pQrStUvWxYz1234567890AbCdEfGhI";
export const TOKEN_2 = "Zz9_-yX8wVuT7sRqP6oNmL5kJiH4gFeD3cBa2A1b0Cd";
export const TOKEN_3 = "Qq1-_Ww2EeRr3TtYy4UuIi5OoPp6AaSs7DdFf8GgHhJ";

export const CLAIM_PATH = (couponId: string) =>
  `POST /api/v1/clientes/coupons/${couponId}/claims`;
export const CLAIMS_GET = "GET /api/v1/clientes/claims";
export const REISSUE = (claimId: string) =>
  `POST /api/v1/clientes/claims/${claimId}/qr`;

export const COPY = {
  ...MAP_COPY,
  walletLoading: "Cargando billetera…",
  walletEmpty: "Aún no tienes cupones. Reclama uno desde Inicio",
  walletError: "No pudimos cargar tu billetera. Intenta de nuevo",
  claim: "Reclamar",
  claimed: "Cupón reclamado",
  viewWallet: "Ver Billetera",
  claimError: "No pudimos reclamar el cupón. Intenta de nuevo",
  viewQr: "Ver QR",
  qrLoading: "Preparando tu código…",
  qrInstruction: "Muestra este código en la tienda",
  qrError: "No pudimos mostrar tu código QR. Intenta de nuevo",
  qrLabel: "Código QR del cupón",
  unavailable: "Este cupón ya no está disponible",
  close: "Cerrar",
};

export const qrKey = (claimId: string, userId = "user-1") =>
  `savanhi-clientes-qr.${userId}.${claimId}`;

// ---- a server that knows claims -------------------------------------------------
export const wallet = {
  claims: [] as CustomerClaim[],
  claimedCoupons: new Set<string>(),
  nextClaimId: [CLAIM_1, CLAIM_2],
  nextTokens: [TOKEN_1, TOKEN_2, TOKEN_3],
};

export const claimRecord = (
  id: string,
  couponId: string,
  status: CustomerClaimStatus,
  qrToken: string | null = null,
): CustomerClaim => {
  const near = couponId === COUPON_2 ? NEAR_B : NEAR_A;
  const coupon = feedItem(
    couponId,
    couponId === COUPON_2 ? "Pan del Vecino" : COUPON_A,
    near,
    false,
    false,
  ).coupon;
  return {
    id,
    status,
    qrToken,
    claimedOn: "2026-11-10",
    redeemedOn: status === "redeemed" ? "2026-11-11" : null,
    coupon,
    store: { id: near.id, name: near.name },
  };
};

export function serveWallet() {
  wallet.claims = [];
  wallet.claimedCoupons = new Set();
  wallet.nextClaimId = [CLAIM_1, CLAIM_2];
  wallet.nextTokens = [TOKEN_1, TOKEN_2, TOKEN_3];

  const baseFeed = routes.get(FEED)!;
  routes.set(FEED, (c) => {
    const answer = baseFeed(c) as ReturnType<typeof reply>;
    return {
      ...answer,
      json: async () => {
        const body = (await answer.json()) as {
          data: Array<{ coupon: { id: string }; claimed: boolean }>;
        };
        return {
          data: body.data.map((item) => ({
            ...item,
            claimed: wallet.claimedCoupons.has(item.coupon.id),
          })),
        };
      },
    };
  });

  for (const couponId of [COUPON_1, COUPON_2]) {
    routes.set(CLAIM_PATH(couponId), () => {
      const id = wallet.nextClaimId.shift()!;
      wallet.claimedCoupons.add(couponId);
      const claim = claimRecord(id, couponId, "claimed");
      wallet.claims.unshift({ ...claim });
      return reply(201, {
        data: { ...claim, qrToken: wallet.nextTokens.shift()! },
      });
    });
  }
  routes.set(CLAIMS_GET, () =>
    reply(200, { data: wallet.claims.map((c) => ({ ...c, qrToken: null })) }),
  );
  for (const id of [CLAIM_1, CLAIM_2, CLAIM_3, CLAIM_4]) {
    routes.set(REISSUE(id), () => {
      const claim = wallet.claims.find((c) => c.id === id)!;
      return reply(200, {
        data: { ...claim, qrToken: wallet.nextTokens.shift()! },
      });
    });
  }
}

// ---- tabs with Inicio and Billetera over the real guard and providers -----------
export const walletUi = { setWalletFocus: (_focused: boolean) => {} };

export function WalletTabs() {
  const [mounted, setMounted] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  walletUi.setWalletFocus = (next) => {
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

/** Tab hrefs the app asked for; only the auth area really changes the screen. */
export const visited: string[] = [];

export function WalletApp() {
  const [path, setPath] = React.useState("/");
  mockNav.go = (href: string) => {
    if (href.startsWith("/auth")) setPath(href);
    else visited.push(href);
  };
  mockNav.path = path;
  return (
    <AuthProvider>
      <Probe />
      {path === "/" ? (
        <WalletTabs />
      ) : (
        <AuthGuard area="auth">
          <View testID={`auth-area:${path}`} />
        </AuthGuard>
      )}
    </AuthProvider>
  );
}

// ---- what the production QR renderer drew, decoded back with jsQR ---------------
type DrawnNode = { type: unknown; props: Record<string, unknown> };
const drawn = (): DrawnNode[] =>
  screen.UNSAFE_root.findAll(() => true) as unknown as DrawnNode[];
export const qrPathData = () =>
  drawn()
    .map((n) => n.props.d)
    .filter((d): d is string => typeof d === "string");
export const qrViewBox = () =>
  drawn()
    .map((n) => n.props.viewBox)
    .find((v): v is string => typeof v === "string");
export const QR_CELL = /M(\d+) (\d+)h(\d+)v1h-\d+z/g;

/** Rasterizes the drawn path (not an independent encoder), so a wrong cell fails. */
export function rasterizeQr(scale = 6) {
  const side = Number(qrViewBox()?.split(" ")[2]);
  const width = side * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const d of qrPathData()) {
    for (const m of d.matchAll(QR_CELL)) {
      const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
      for (let py = y * scale; py < (y + 1) * scale; py += 1) {
        for (let px = x * scale; px < (x + w) * scale; px += 1) {
          const at = (py * width + px) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
        }
      }
    }
  }
  return { pixels, width };
}
export function decodeDrawnQr(): string | null {
  if (qrPathData().length === 0) return null;
  const { pixels, width } = rasterizeQr();
  return jsQR(pixels, width, width)?.data ?? null;
}
export const qrIsDrawn = () => qrPathData().length > 0;

export const walletView = () => within(screen.getByTestId("billetera"));
export const inicio = inicioView;

export async function openInicioWithWallet() {
  seed();
  const view = render(<WalletApp />);
  await screen.findByTestId("inicio");
  await inicio().findByText(COUPON_A);
  return view;
}
export async function focusWallet() {
  await act(async () => {
    walletUi.setWalletFocus(true);
  });
  await settle();
}
export async function blurWallet() {
  await act(async () => {
    walletUi.setWalletFocus(false);
  });
}

export const emitAppState = (state: "active" | "background") =>
  act(async () => {
    appStateHandlers.forEach((handler) => handler(state));
  });

/** Every console channel is captured so a leaked token would fail a test. */
export const logSpies = ["log", "info", "warn", "error", "debug"].map((m) =>
  jest.spyOn(console, m as "log").mockImplementation(() => {}),
);
export const logged = () => JSON.stringify(logSpies.map((s) => s.mock.calls));

export function installWalletHarness() {
  installMapHarness();
  beforeEach(() => {
    visited.length = 0;
    logSpies.forEach((s) => s.mockClear());
    server.followed = new Set([STORE_A]);
    serveWallet();
  });
}

export { backing, calls, routes };
