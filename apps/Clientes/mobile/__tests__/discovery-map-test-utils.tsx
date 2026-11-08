import React from "react";
import { AppState, View } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import Mapbox from "@rnmapbox/maps";
import type {
  CustomerCouponFeedItem,
  NearbyStore,
} from "@repo/api-contracts";

import { AuthGuard } from "@/src/features/auth/presentation/AuthGuard";
import {
  AuthProvider,
  useAuth,
} from "@/src/features/auth/presentation/AuthProvider";
import { CLIENT_SESSION_STORAGE_KEY } from "@/src/features/auth/infrastructure/session-storage";
import { DiscoveryProvider } from "@/src/features/discovery/presentation/DiscoveryProvider";
import InicioScreen from "@/src/features/discovery/presentation/InicioScreen";
import MapScreen from "@/src/features/discovery/presentation/MapScreen";

// ---- mocked edges: router, safe area, token config, OS foreground ----------
jest.mock("expo-router", () => {
  const React = jest.requireActual("react");
  const FocusContext = React.createContext(true);
  const go = (href: string) => (global as any).mockNav.go(href);
  return {
    __FocusContext: FocusContext,
    useRouter: () => ({ push: go, replace: go }),
    usePathname: () => (global as any).mockNav.path,
    // Runs the effect while the screen is focused, like the real hook.
    useFocusEffect: (effect: () => void) => {
      const focused = React.useContext(FocusContext);
      React.useEffect(() => (focused ? effect() : undefined), [focused, effect]);
    },
    Redirect: ({ href }: { href: string }) => {
      React.useEffect(() => {
        (global as any).mockNav.redirects.push(href);
        go(href);
      }, [href]);
      return null;
    },
  };
});
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaView: View,
  };
});
// Only `extra.MAPBOX_ACCESS_TOKEN` is replaced; every other value is the
// jest-expo default, so the API address resolves as in the other suites.
jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  const base = actual.default ?? actual;
  return {
    __esModule: true,
    default: new Proxy(base, {
      get: (target, key) =>
        key === "expoConfig"
          ? {
              ...target.expoConfig,
              extra: {
                ...target.expoConfig?.extra,
                MAPBOX_ACCESS_TOKEN: (global as any).mockMapboxToken,
              },
            }
          : target[key],
    }),
  };
});
const { __FocusContext: FocusContext } = jest.requireMock("expo-router");

export const mockNav = (global as any).mockNav ?? {
  path: "/",
  go: (_href: string) => {},
  redirects: [] as string[],
};
(global as any).mockNav = mockNav;
export const PUBLIC_TOKEN = "pk.synthetic.fixture";

// ---- a tiny tabs simulation: the real guard and the real provider ----------
export const ui = { setMapFocus: (_focused: boolean) => {} };

export function Tabs() {
  const [mapMounted, setMapMounted] = React.useState(false);
  const [mapFocused, setMapFocused] = React.useState(false);
  ui.setMapFocus = (focused) => {
    if (focused) setMapMounted(true);
    setMapFocused(focused);
  };
  return (
    <AuthGuard area="tabs">
      <DiscoveryProvider>
        <View testID="inicio">
          <FocusContext.Provider value={!mapFocused}>
            <InicioScreen />
          </FocusContext.Provider>
        </View>
        {mapMounted ? (
          <View testID="mapa">
            <FocusContext.Provider value={mapFocused}>
              <MapScreen />
            </FocusContext.Provider>
          </View>
        ) : null}
      </DiscoveryProvider>
    </AuthGuard>
  );
}

export let probeAuth: ReturnType<typeof useAuth>;
export function Probe() {
  probeAuth = useAuth();
  return null;
}

export function Screen({ path }: { path: string }) {
  mockNav.path = path;
  if (path === "/") return <Tabs />;
  return (
    <AuthGuard area="auth">
      <View testID={`auth-area:${path}`} />
    </AuthGuard>
  );
}

export function MiniApp() {
  const [path, setPath] = React.useState("/");
  mockNav.go = (href: string) => setPath(href);
  return (
    <AuthProvider>
      <Probe />
      <Screen path={path} />
    </AuthProvider>
  );
}

// ---- fetch / keystore fakes -------------------------------------------------
export const backing = (SecureStore as unknown as { __store: Map<string, string> })
  .__store;
export type Call = { key: string; url: string; query: URLSearchParams };
export type Reply = {
  ok: boolean;
  status: number;
  headers: { get: (n: string) => string | null };
  json: () => Promise<unknown>;
};
export const reply = (status: number, body: unknown): Reply => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
});
export const calls: Call[] = [];
export const routes = new Map<string, (c: Call) => Reply | Promise<Reply>>();
export const callsTo = (key: string) => calls.filter((c) => c.key === key);
export function deferred<T = Reply>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const FAR_FUTURE = 32_503_680_000_000;
export let tid = 0;
export const acc = (n: number) => `access-${tid}-${n}`;
export const ref = (n: number) => `refresh-${tid}-${n}`;

export const FEED = "GET /api/v1/clientes/coupons/feed";
export const NEARBY = "GET /api/v1/clientes/stores/nearby";
export const FOLLOWED = "GET /api/v1/clientes/stores/followed";
export const PROFILE_GET = "GET /api/v1/clientes/profile";
export const FOLLOW_PUT = (id: string) => `PUT /api/v1/clientes/stores/${id}/follow`;
export const FOLLOW_DELETE = (id: string) =>
  `DELETE /api/v1/clientes/stores/${id}/follow`;

export const COPY = {
  denied:
    "La ubicación es necesaria para mostrarte tiendas cercanas. Puedes activarla más adelante desde los ajustes de Savanhi en tu teléfono",
  searching: "Buscando tiendas cercanas…",
  noStores: "No hay tiendas cercanas",
  storesError: "No pudimos cargar las tiendas. Intenta de nuevo",
  followError: "No pudimos actualizar el seguimiento. Intenta de nuevo",
  loadingCoupons: "Cargando cupones…",
  retry: "Reintentar",
  follow: "Seguir",
  following: "Siguiendo",
  unfollow: "Dejar de seguir",
};

export const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const POS_1 = { latitude: -0.18, longitude: -78.48 };
export const POS_2 = { latitude: -0.2, longitude: -78.5 };

export const nearbyStore = (
  id: string,
  name: string,
  o: Partial<NearbyStore> = {},
): NearbyStore => ({
  id,
  name,
  address: `${name}, calle 1`,
  latitude: -0.181,
  longitude: -78.481,
  distanceMeters: 350,
  distanceKm: 0.35,
  ...o,
});
export const NEAR_A = nearbyStore(STORE_A, "Tienda Doña Rosa");
export const NEAR_B = nearbyStore(STORE_B, "Minimarket El Vecino", {
  latitude: -0.19,
  longitude: -78.49,
  distanceMeters: 1234,
  distanceKm: 1.23,
});

export const feedItem = (
  couponId: string,
  title: string,
  near: NearbyStore,
  followed: boolean,
  withDistance: boolean,
): CustomerCouponFeedItem => ({
  coupon: {
    id: couponId,
    storeId: near.id,
    type: "percentage",
    title,
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
  },
  store: {
    id: near.id,
    name: near.name,
    address: near.address,
    latitude: near.latitude,
    longitude: near.longitude,
    distanceMeters: withDistance ? near.distanceMeters : null,
    distanceKm: withDistance ? near.distanceKm : null,
  },
  followed,
  claimed: false,
});

// A small server: who is followed decides the feed, the list and the answers.
export const server = { followed: new Set<string>(), nearby: [NEAR_A, NEAR_B] as NearbyStore[] };
export const COUPON_A = "Arroz de Rosa";
export const COUPON_B = "Pan del Vecino";
export function serveDefaults() {
  server.followed = new Set([STORE_A]);
  server.nearby = [NEAR_A, NEAR_B];
  routes.set(FEED, (c) => {
    const withPair = c.query.has("lat") && c.query.has("lng");
    const stores = withPair ? server.nearby : server.nearby.filter((s) => server.followed.has(s.id));
    const items = stores.map((s) =>
      feedItem(
        s.id === STORE_A ? "c1111111-1111-4111-8111-111111111111" : "c2222222-2222-4222-8222-222222222222",
        s.id === STORE_A ? COUPON_A : COUPON_B,
        s,
        server.followed.has(s.id),
        withPair,
      ),
    );
    return reply(200, { data: items });
  });
  routes.set(NEARBY, () => reply(200, { data: server.nearby }));
  routes.set(FOLLOWED, () =>
    reply(200, {
      data: server.nearby
        .filter((s) => server.followed.has(s.id))
        .map(({ id, name, address, latitude, longitude }) => ({ id, name, address, latitude, longitude })),
    }),
  );
  for (const id of [STORE_A, STORE_B]) {
    routes.set(FOLLOW_PUT(id), () => {
      server.followed.add(id);
      return reply(200, { data: { storeId: id, following: true } });
    });
    routes.set(FOLLOW_DELETE(id), () => {
      server.followed.delete(id);
      return reply(200, { data: { storeId: id, following: false } });
    });
  }
}

export const user = (o: Record<string, unknown> = {}) => ({
  id: "user-1",
  email: "cliente@example.test",
  fullName: "Ana Pérez",
  role: "client",
  active: true,
  emailVerifiedAt: "2026-11-08T00:00:00.000Z",
  registrationStatus: "completed",
  ...o,
});
export const profile = (o: Record<string, unknown> = {}) => ({
  fullName: "Ana Pérez",
  birthDate: "1990-01-01",
  eligibility: "eligible",
  ...o,
});
export function seed(u = user()) {
  backing.set(
    CLIENT_SESSION_STORAGE_KEY,
    JSON.stringify({
      user: u,
      session: { accessToken: acc(1), refreshToken: ref(1), expiresAt: FAR_FUTURE },
    }),
  );
  routes.set("GET /auth/me", () => reply(200, { user: u }));
  routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
}
/** Every string the screen actually renders, in document order (props excluded). */
export function renderedText(): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") parts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object" && "children" in node) {
      for (const child of (node as { children: unknown[] | null }).children ?? []) {
        walk(child);
      }
    }
  };
  walk(screen.toJSON());
  return parts.join("\n");
}
export const settle = () =>
  act(async () => {
    await new Promise((r) => setImmediate(r));
  });

// ---- the fake operating system ----------------------------------------------
export type Status = "undetermined" | "granted" | "denied";
export const os = {
  status: "undetermined" as Status,
  canAskAgain: true,
  accuracy: "fine" as "fine" | "coarse",
  onRequest: "granted" as Status,
  position: (): Promise<unknown> => Promise.resolve({ coords: { ...POS_1 } }),
  request: (): Promise<void> => Promise.resolve(),
};
export const getPermission = Location.getForegroundPermissionsAsync as jest.Mock;
export const requestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
export const getPosition = Location.getCurrentPositionAsync as jest.Mock;
export const emitActiveState = () =>
  act(async () => {
    appStateHandlers.forEach((handler) => handler("active"));
  });
export let appStateHandlers: Array<(state: string) => void> = [];
export let appStateSpy: jest.SpyInstance;

export const noOsCalls = () => {
  expect(getPermission).not.toHaveBeenCalled();
  expect(requestPermission).not.toHaveBeenCalled();
  expect(getPosition).not.toHaveBeenCalled();
};

export const inicio = () => within(screen.getByTestId("inicio"));
export const mapa = () => within(screen.getByTestId("mapa"));
export const hostNodes = (type: string) =>
  screen.UNSAFE_root.findAll((node: { type: unknown }) => node.type === (type as any));
export const mapViews = () => hostNodes("MapView");

export async function openInicio() {
  seed();
  render(<MiniApp />);
  await screen.findByTestId("inicio");
  await inicio().findByText(COUPON_A);
}
export async function focusMap() {
  await act(async () => {
    ui.setMapFocus(true);
  });
}
export async function blurMap() {
  await act(async () => {
    ui.setMapFocus(false);
  });
}

export function installMapHarness() {
  beforeEach(() => {
    tid += 1;
    backing.clear();
    routes.clear();
    calls.length = 0;
    mockNav.redirects.length = 0;
    (global as any).mockMapboxToken = PUBLIC_TOKEN;
    (Mapbox.setAccessToken as jest.Mock).mockClear();
    Object.values(Location).forEach((fn) => (fn as any)?.mockReset?.());
    Object.assign(os, {
      status: "undetermined",
      canAskAgain: true,
      accuracy: "fine",
      onRequest: "granted",
      position: () => Promise.resolve({ coords: { ...POS_1 } }),
      request: () => Promise.resolve(),
    });
    getPermission.mockImplementation(async () => ({
      status: os.status,
      granted: os.status === "granted",
      canAskAgain: os.canAskAgain,
      android: { accuracy: os.status === "granted" ? os.accuracy : "none" },
    }));
    requestPermission.mockImplementation(async () => {
      await os.request();
      os.status = os.onRequest;
      return {
        status: os.status,
        granted: os.status === "granted",
        canAskAgain: os.canAskAgain,
      };
    });
    getPosition.mockImplementation(() => os.position());
    appStateHandlers = [];
    appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _type: string,
      handler: (state: string) => void,
    ) => {
      appStateHandlers.push(handler);
      return {
        remove: () => {
          appStateHandlers = appStateHandlers.filter((h) => h !== handler);
        },
      };
    }) as any);
    serveDefaults();
    (global as any).fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
      const parsed = new URL(url);
      const call: Call = {
        key: `${init.method ?? "GET"} ${parsed.pathname}`,
        url,
        query: parsed.searchParams,
      };
      calls.push(call);
      const route = routes.get(call.key);
      if (!route) throw new Error("offline");
      return route(call);
    });
  });

  afterEach(() => {
    appStateSpy.mockRestore();
  });
}
