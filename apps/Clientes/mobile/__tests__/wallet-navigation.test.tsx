// Real expo-router (no router mock): pressing «Ver Billetera» must land on the
// real /wallet tab route of the real tabs layout, with the real providers.
import React from "react";
import { Slot } from "expo-router";
import {
  fireEvent,
  renderRouter,
  screen,
  waitFor,
} from "expo-router/testing-library";
import * as SecureStore from "expo-secure-store";

import { CLIENT_SESSION_STORAGE_KEY } from "@/src/features/auth/infrastructure/session-storage";
import { AuthProvider } from "@/src/features/auth/presentation/AuthProvider";

const COUPON_ID = "c1111111-1111-4111-8111-111111111111";
const STORE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLAIM_ID = "d1111111-1111-4111-8111-111111111111";
const TOKEN = "aB3-_xY9kLmN0pQrStUvWxYz1234567890AbCdEfGhI";

const backing = (
  SecureStore as unknown as { __store: Map<string, string> }
).__store;

const user = {
  id: "user-1",
  email: "c@example.test",
  fullName: "Ana",
  role: "client",
  active: true,
  emailVerifiedAt: "2026-11-08T00:00:00.000Z",
  registrationStatus: "completed",
};
const coupon = {
  id: COUPON_ID,
  storeId: STORE_ID,
  type: "percentage",
  title: "Arroz de Rosa",
  description: null,
  freeText: null,
  percentageValue: 15,
  fixedAmountValue: null,
  validFrom: "2026-11-01",
  validTo: "2026-11-25",
  totalStock: 40,
  claimedCount: 0,
  remainingStock: 40,
  paused: false,
  imageUrl: null,
  products: [],
};
const store = {
  id: STORE_ID,
  name: "Tienda",
  address: "x",
  latitude: -0.1,
  longitude: -78.4,
  distanceMeters: null,
  distanceKm: null,
};

let claimed = false;
const claim = (qrToken: string | null) => ({
  id: CLAIM_ID,
  status: "claimed",
  qrToken,
  claimedOn: "2026-11-10",
  redeemedOn: null,
  coupon,
  store: { id: STORE_ID, name: "Tienda" },
});
const answer = (body: unknown, status = 200) => ({
  ok: status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
});

beforeEach(() => {
  claimed = false;
  backing.clear();
  backing.set(
    CLIENT_SESSION_STORAGE_KEY,
    JSON.stringify({
      user,
      session: {
        accessToken: "access-route",
        refreshToken: "refresh-route-unique",
        expiresAt: 32_503_680_000_000,
      },
    }),
  );
  (global as { fetch: unknown }).fetch = jest.fn(
    async (url: string, init: { method?: string } = {}) => {
      const path = new URL(url).pathname;
      const method = init.method ?? "GET";
      if (path === "/auth/me") return answer({ user });
      if (path === "/api/v1/clientes/profile") {
        return answer({
          data: {
            fullName: "Ana",
            birthDate: "1990-01-01",
            eligibility: "eligible",
          },
        });
      }
      if (path === "/api/v1/clientes/coupons/feed") {
        return answer({ data: [{ coupon, store, followed: true, claimed }] });
      }
      if (path === `/api/v1/clientes/coupons/${COUPON_ID}/claims` && method === "POST") {
        claimed = true;
        return answer({ data: claim(TOKEN) }, 201);
      }
      if (path === "/api/v1/clientes/claims") {
        return answer({ data: claimed ? [claim(null)] : [] });
      }
      throw new Error(`offline ${method} ${path}`);
    },
  );
});

it("«Ver Billetera» navigates the REAL router to /wallet and Billetera renders the claim", async () => {
  const Stub = () => null;
  const router = renderRouter(
    {
      _layout: () => (
        <AuthProvider>
          <Slot />
        </AuthProvider>
      ),
      "(tabs)/_layout": require("../app/(tabs)/_layout").default,
      "(tabs)/index": require("../app/(tabs)/index").default,
      "(tabs)/map": Stub,
      "(tabs)/wallet": require("../app/(tabs)/wallet").default,
      "(tabs)/profile": Stub,
      "auth/welcome": Stub,
    },
    { initialUrl: "/" },
  );

  fireEvent.press(await screen.findByText("Reclamar"));
  await screen.findByText("Cupón reclamado");
  // No automatic navigation: the customer stays in Inicio.
  expect(router.getPathname()).toBe("/");

  fireEvent.press(screen.getByText("Ver Billetera"));
  await waitFor(() => expect(router.getPathname()).toBe("/wallet"));
  await screen.findByText("Disponible");
  expect(screen.getByText("Ver QR")).toBeTruthy();
});
