import React from "react";
import { PermissionsAndroid, Text } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import type {
  CustomerCouponFeedItem,
  CustomerFeedStore,
} from "@repo/api-contracts";

import InicioScreen from "@/src/features/discovery/presentation/InicioScreen";
import { AuthGuard } from "@/src/features/auth/presentation/AuthGuard";
import {
  AuthProvider,
  useAuth,
} from "@/src/features/auth/presentation/AuthProvider";
import { CLIENT_SESSION_STORAGE_KEY } from "@/src/features/auth/infrastructure/session-storage";

// A location module would be a new native dependency; importing one fails.
jest.mock(
  "expo-location",
  () => {
    throw new Error("the first Inicio must not touch location");
  },
  { virtual: true },
);

// ---- tiny router simulation: real guards, mocked expo-router ---------------
const mockNav = {
  path: "/",
  go: (_href: string) => {},
  redirects: [] as string[],
};

jest.mock("expo-router", () => {
  const React = jest.requireActual("react");
  const go = (href: string) => mockNav.go(href);
  return {
    useRouter: () => ({ push: go, replace: go }),
    usePathname: () => mockNav.path,
    Redirect: ({ href }: { href: string }) => {
      React.useEffect(() => {
        mockNav.redirects.push(href);
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

let probeAuth: ReturnType<typeof useAuth>;
function Probe() {
  probeAuth = useAuth();
  return null;
}

function Screen({ path }: { path: string }) {
  mockNav.path = path;
  if (path === "/") {
    return (
      <AuthGuard area="tabs">
        <InicioScreen />
      </AuthGuard>
    );
  }
  return (
    <AuthGuard area="auth">
      <Text>{`auth-area:${path}`}</Text>
    </AuthGuard>
  );
}

function MiniApp() {
  const [path, setPath] = React.useState("/");
  mockNav.go = (href) => setPath(href);
  return (
    <AuthProvider>
      <Probe />
      <Screen path={path} />
    </AuthProvider>
  );
}

// ---- fetch / keystore fakes -------------------------------------------------
const backing = (SecureStore as unknown as { __store: Map<string, string> })
  .__store;
type Call = { key: string; url: string; headers: Record<string, string> };
type Reply = {
  ok: boolean;
  status: number;
  headers: { get: (n: string) => string | null };
  json: () => Promise<unknown>;
};
const reply = (status: number, body: unknown): Reply => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
});
const calls: Call[] = [];
const routes = new Map<string, (c: Call) => Reply | Promise<Reply>>();
const callsTo = (key: string) => calls.filter((c) => c.key === key);
function deferred() {
  let resolve!: (r: Reply) => void;
  const promise = new Promise<Reply>((res) => (resolve = res));
  return { promise, resolve };
}

// Tokens are unique per test: the refresh single-flight cache is module-level
// (60 s reuse). The expiry is a fixed far-future instant, never `Date.now()`.
const FAR_FUTURE = 32_503_680_000_000;
let tid = 0;
const acc = (n: number) => `access-${tid}-${n}`;
const ref = (n: number) => `refresh-${tid}-${n}`;

const FEED = "GET /api/v1/clientes/coupons/feed";
const FOLLOWED = "GET /api/v1/clientes/stores/followed";
const PROFILE_GET = "GET /api/v1/clientes/profile";
const REFRESH = "POST /auth/refresh";
const FOLLOW_PUT = (id: string) => `PUT /api/v1/clientes/stores/${id}/follow`;
const FOLLOW_DELETE = (id: string) =>
  `DELETE /api/v1/clientes/stores/${id}/follow`;

const COPY = {
  loading: "Cargando cupones…",
  empty: "No hay cupones disponibles por ahora",
  noFollows:
    "Aún no sigues ninguna tienda. Abre el Mapa para encontrar tiendas cercanas",
  couponsError: "No pudimos cargar los cupones. Intenta de nuevo",
  storesError: "No pudimos cargar las tiendas. Intenta de nuevo",
  follow: "Seguir",
  following: "Siguiendo",
  unfollow: "Dejar de seguir",
  followError: "No pudimos actualizar el seguimiento. Intenta de nuevo",
  retry: "Reintentar",
};

const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const IMAGE_URL = "https://garage.test/bucket/img?X-Amz-Signature=abc123";

const store = (
  id: string,
  name: string,
  o: Partial<CustomerFeedStore> = {},
): CustomerFeedStore => ({
  id,
  name,
  address: `${name}, calle 1`,
  latitude: null,
  longitude: null,
  distanceMeters: null,
  distanceKm: null,
  ...o,
});
const item = (
  couponId: string,
  title: string,
  s: CustomerFeedStore,
  o: Partial<CustomerCouponFeedItem> = {},
): CustomerCouponFeedItem => ({
  coupon: {
    id: couponId,
    storeId: s.id,
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
  store: s,
  followed: true,
  claimed: false,
  ...o,
});
const SA = store(STORE_A, "Tienda Doña Rosa");
const SB = store(STORE_B, "Minimarket El Vecino");
const C1 = "c1111111-1111-4111-8111-111111111111";
const C2 = "c2222222-2222-4222-8222-222222222222";
const C3 = "c3333333-3333-4333-8333-333333333333";

const user = (o: Record<string, unknown> = {}) => ({
  id: "user-1",
  email: "cliente@example.test",
  fullName: "Ana Pérez",
  role: "client",
  active: true,
  emailVerifiedAt: "2026-11-08T00:00:00.000Z",
  registrationStatus: "completed",
  ...o,
});
const profile = (o: Record<string, unknown> = {}) => ({
  fullName: "Ana Pérez",
  birthDate: "1990-01-01",
  eligibility: "eligible",
  ...o,
});
const sessionOf = (n = 1) => ({
  accessToken: acc(n),
  refreshToken: ref(n),
  expiresAt: FAR_FUTURE,
});
function seed(u = user(), s = sessionOf()) {
  backing.set(
    CLIENT_SESSION_STORAGE_KEY,
    JSON.stringify({ user: u, session: s }),
  );
  routes.set("GET /auth/me", () => reply(200, { user: u }));
  routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
}
const stored = () => backing.get(CLIENT_SESSION_STORAGE_KEY) ?? null;
const serveFeed = (items: unknown[]) =>
  routes.set(FEED, () => reply(200, { data: items }));
const serveFollowed = (stores: unknown[]) =>
  routes.set(FOLLOWED, () => reply(200, { data: stores }));
/** Every string the screen actually renders, joined in document order. */
function renderedText(): string {
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
const settle = () =>
  act(async () => {
    await new Promise((r) => setImmediate(r));
  });

beforeEach(() => {
  tid += 1;
  backing.clear();
  routes.clear();
  calls.length = 0;
  mockNav.redirects.length = 0;
  (SecureStore.getItemAsync as jest.Mock).mockClear();
  (SecureStore.setItemAsync as jest.Mock).mockClear();
  (SecureStore.deleteItemAsync as jest.Mock).mockClear();
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const call: Call = {
      key: `${method} ${new URL(url).pathname}`,
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const route = routes.get(call.key);
    if (!route) throw new Error("offline");
    return route(call);
  });
});

describe("the first Inicio", () => {
  it("asks for the feed with neither lat nor lng and never asks for location", async () => {
    const request = jest.spyOn(PermissionsAndroid, "request");
    const geolocation = { getCurrentPosition: jest.fn(), watchPosition: jest.fn() };
    (global as any).navigator = { ...(global as any).navigator, geolocation };
    const pending = deferred();
    seed();
    routes.set(FEED, () => pending.promise);

    render(<MiniApp />);
    expect(await screen.findByText(COPY.loading)).toBeTruthy();

    await act(async () => {
      pending.resolve(reply(200, { data: [item(C1, "15% en arroz", SA)] }));
    });
    await screen.findByText("15% en arroz");

    const feedCalls = callsTo(FEED);
    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.url).toBe(
      "http://localhost:4300/api/v1/clientes/coupons/feed",
    );
    expect(feedCalls[0]!.url).not.toMatch(/lat|lng|\?/);
    expect(feedCalls[0]!.headers.Authorization).toBe(`Bearer ${acc(1)}`);
    expect(request).not.toHaveBeenCalled();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    request.mockRestore();
  });

  it("makes no request before the profile gate is open, and none for another role", async () => {
    seed(user({ role: "tendero" }));
    serveFeed([item(C1, "15% en arroz", SA)]);

    render(<MiniApp />);
    await screen.findByText("auth-area:/auth/profile");
    await settle();

    expect(callsTo(FEED)).toHaveLength(0);
    expect(callsTo(FOLLOWED)).toHaveLength(0);
  });
});

describe("the real cards", () => {
  it("renders only server fields, in server order, with no id, clock time or Reclamar", async () => {
    seed();
    const near = item(C2, "Combo gaseosa", SA, {
      claimed: true,
    });
    near.coupon = {
      ...near.coupon,
      percentageValue: null,
      fixedAmountValue: 0.5,
      description: "Con tu compra",
      imageUrl: IMAGE_URL,
    };
    near.store = { ...SA, distanceMeters: 170, distanceKm: 0.17 };
    const far = item(C1, "15% en arroz", SB);
    far.store = { ...SB, distanceMeters: 12369, distanceKm: 12.37 };
    const noDistance = item(C3, "Pan de yuca", SB);
    noDistance.coupon = {
      ...noDistance.coupon,
      percentageValue: null,
      freeText: "Pan gratis",
    };
    serveFeed([near, far, noDistance]);

    render(<MiniApp />);
    await screen.findByText("Combo gaseosa");

    const text = renderedText();
    expect(text.indexOf("Combo gaseosa")).toBeLessThan(
      text.indexOf("15% en arroz"),
    );
    expect(text.indexOf("15% en arroz")).toBeLessThan(text.indexOf("Pan de yuca"));
    expect(screen.getByText("Con tu compra")).toBeTruthy();
    expect(screen.getByText("$0.50")).toBeTruthy();
    expect(screen.getByText("15%")).toBeTruthy();
    expect(screen.getByText("Pan gratis")).toBeTruthy();
    expect(screen.getAllByText("1 nov 2026 – 25 nov 2026")).toHaveLength(3);
    expect(screen.getByText("Tienda Doña Rosa")).toBeTruthy();
    expect(screen.getAllByText("Minimarket El Vecino")).toHaveLength(2);
    expect(screen.getByText("Tienda Doña Rosa, calle 1")).toBeTruthy();
    expect(screen.getByText("A 170 m")).toBeTruthy();
    expect(screen.getByText("A 12.4 km")).toBeTruthy();
    expect(screen.getByText("Sin distancia")).toBeTruthy();
    expect(screen.queryByText("A 0 km")).toBeNull();

    expect(text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(text).not.toMatch(/\b\d{1,2}:\d{2}\b/);
    expect(text).not.toContain(IMAGE_URL);
    expect(screen.queryByText(/reclamar/i)).toBeNull();
    expect(screen.queryByLabelText(/reclamar/i)).toBeNull();
  });

  it("keeps the feed in memory only: nothing but the session is persisted", async () => {
    seed();
    const withImage = item(C1, "15% en arroz", SA);
    withImage.coupon = { ...withImage.coupon, imageUrl: IMAGE_URL };
    serveFeed([withImage]);

    render(<MiniApp />);
    await screen.findByText("15% en arroz");
    await settle();

    expect([...backing.keys()]).toEqual([CLIENT_SESSION_STORAGE_KEY]);
    for (const [key, value] of (SecureStore.setItemAsync as jest.Mock).mock
      .calls) {
      expect(key).toBe(CLIENT_SESSION_STORAGE_KEY);
      expect(String(value)).not.toContain("15% en arroz");
      expect(String(value)).not.toContain(IMAGE_URL);
    }
  });
});

describe("empty and error states", () => {
  it("distinguishes 'follows no store' from 'follows stores but no coupons'", async () => {
    seed();
    serveFeed([]);
    serveFollowed([]);
    const first = render(<MiniApp />);
    await screen.findByText(COPY.noFollows);
    expect(screen.queryByText(COPY.empty)).toBeNull();
    first.unmount();

    calls.length = 0;
    serveFollowed([
      { id: STORE_A, name: "Tienda", address: null, latitude: null, longitude: null },
    ]);
    render(<MiniApp />);
    await screen.findByText(COPY.empty);
    expect(screen.queryByText(COPY.noFollows)).toBeNull();
  });

  it("reads the followed list only when the feed is empty", async () => {
    seed();
    serveFeed([item(C1, "15% en arroz", SA)]);

    render(<MiniApp />);
    await screen.findByText("15% en arroz");
    await settle();

    expect(callsTo(FOLLOWED)).toHaveLength(0);
  });

  it("shows the approved feed error with Reintentar, never server text, and retries", async () => {
    seed();
    let attempt = 0;
    routes.set(FEED, () => {
      attempt += 1;
      return attempt === 1
        ? reply(502, { error: "secret-server-text" })
        : reply(200, { data: [item(C1, "15% en arroz", SA)] });
    });

    render(<MiniApp />);
    await screen.findByText(COPY.couponsError);
    expect(screen.queryByText(/secret-server-text/)).toBeNull();
    expect(screen.queryByText(COPY.loading)).toBeNull();

    fireEvent.press(screen.getByText(COPY.retry));
    await screen.findByText("15% en arroz");
    expect(screen.queryByText(COPY.couponsError)).toBeNull();
    expect(callsTo(FEED)).toHaveLength(2);
  });

  it("shows the approved stores error when the followed list cannot be read", async () => {
    seed();
    serveFeed([]);
    routes.set(FOLLOWED, () => reply(429, { error: "secret-server-text" }));

    render(<MiniApp />);
    await screen.findByText(COPY.storesError);
    expect(screen.queryByText(COPY.noFollows)).toBeNull();
    expect(screen.queryByText(COPY.empty)).toBeNull();
    expect(screen.queryByText(/secret-server-text/)).toBeNull();
    expect(screen.getByText(COPY.retry)).toBeTruthy();
  });

  it("an offline feed shows the error and leaves the gate open", async () => {
    seed();
    render(<MiniApp />);

    await screen.findByText(COPY.couponsError);
    expect(mockNav.redirects).toEqual([]);
    expect(callsTo(PROFILE_GET)).toHaveLength(1);
  });
});

describe("following a store", () => {
  const twoStoreFeed = () => [
    item(C1, "15% en arroz", SA, { followed: false }),
    item(C2, "Combo gaseosa", SA, { followed: false }),
    item(C3, "Pan de yuca", SB, { followed: false }),
  ];

  it("changes nothing until the server confirms, then updates every card of the store", async () => {
    seed();
    serveFeed(twoStoreFeed());
    const pending = deferred();
    routes.set(FOLLOW_PUT(STORE_A), () => pending.promise);

    render(<MiniApp />);
    await screen.findByText("15% en arroz");
    expect(screen.getAllByText(COPY.follow)).toHaveLength(3);

    fireEvent.press(screen.getAllByText(COPY.follow)[0]!);
    await settle();
    expect(callsTo(FOLLOW_PUT(STORE_A))).toHaveLength(1);
    expect(callsTo(FOLLOW_PUT(STORE_A))[0]!.headers.Authorization).toBe(
      `Bearer ${acc(1)}`,
    );
    expect(screen.queryByText(COPY.following)).toBeNull();
    expect(screen.getAllByText(COPY.follow)).toHaveLength(3);

    // The re-read after the confirmed change reports the new truth.
    serveFeed(
      twoStoreFeed().map((entry) =>
        entry.store.id === STORE_A ? { ...entry, followed: true } : entry,
      ),
    );
    await act(async () => {
      pending.resolve(
        reply(200, { data: { storeId: STORE_A, following: true } }),
      );
    });

    await waitFor(() =>
      expect(screen.queryAllByText(COPY.following).length).toBe(2),
    );
    expect(screen.getAllByText(COPY.unfollow)).toHaveLength(2);
    expect(screen.getAllByText(COPY.follow)).toHaveLength(1);
    expect(callsTo(FEED)).toHaveLength(2);
  });

  it("serves a double tap with ONE request and takes a later tap afterwards", async () => {
    seed();
    serveFeed(twoStoreFeed());
    const pending = deferred();
    routes.set(FOLLOW_PUT(STORE_A), () => pending.promise);

    render(<MiniApp />);
    await screen.findByText("15% en arroz");
    const [button] = screen.getAllByText(COPY.follow);
    // All three taps land before React re-renders, so only the hook can stop them.
    act(() => {
      fireEvent.press(button!);
      fireEvent.press(button!);
      fireEvent.press(screen.getAllByText(COPY.follow)[1]!);
    });
    await settle();

    expect(callsTo(FOLLOW_PUT(STORE_A))).toHaveLength(1);

    serveFeed(
      twoStoreFeed().map((entry) =>
        entry.store.id === STORE_A ? { ...entry, followed: true } : entry,
      ),
    );
    await act(async () => {
      pending.resolve(
        reply(200, { data: { storeId: STORE_A, following: true } }),
      );
    });
    await waitFor(() =>
      expect(screen.queryAllByText(COPY.unfollow).length).toBe(2),
    );

    // The pending mark is gone: the store accepts a new action.
    routes.set(FOLLOW_DELETE(STORE_A), () =>
      reply(200, { data: { storeId: STORE_A, following: false } }),
    );
    fireEvent.press(screen.getAllByText(COPY.unfollow)[0]!);
    await waitFor(() => expect(callsTo(FOLLOW_DELETE(STORE_A)).length).toBe(1));
  });

  it("keeps the previous state and shows the approved error when the follow fails", async () => {
    seed();
    serveFeed(twoStoreFeed());
    routes.set(FOLLOW_PUT(STORE_A), () =>
      reply(500, { error: "secret-server-text" }),
    );

    render(<MiniApp />);
    await screen.findByText("15% en arroz");
    const sessionBefore = stored();
    (SecureStore.setItemAsync as jest.Mock).mockClear();
    fireEvent.press(screen.getAllByText(COPY.follow)[0]!);

    await screen.findByText(COPY.followError);
    expect(stored()).toBe(sessionBefore);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(screen.queryByText(/secret-server-text/)).toBeNull();
    expect(screen.getAllByText(COPY.follow)).toHaveLength(3);
    expect(screen.queryByText(COPY.following)).toBeNull();
    expect(callsTo(FEED)).toHaveLength(1);
  });

  it("treats a follow of an inactive store (404) as the same ordinary failure", async () => {
    seed();
    serveFeed(twoStoreFeed());
    routes.set(FOLLOW_PUT(STORE_B), () =>
      reply(404, { error: "Store not found." }),
    );

    render(<MiniApp />);
    await screen.findByText("Pan de yuca");
    fireEvent.press(screen.getAllByText(COPY.follow)[2]!);

    await screen.findByText(COPY.followError);
    expect(screen.queryByText(/Store not found/)).toBeNull();
    expect(screen.getAllByText(COPY.follow)).toHaveLength(3);
  });

  it("an unfollow re-reads the feed so the store's coupons disappear", async () => {
    seed();
    const initial = [
      item(C1, "15% en arroz", SA),
      item(C2, "Combo gaseosa", SA),
      item(C3, "Pan de yuca", SB),
    ];
    serveFeed(initial);
    const pending = deferred();
    routes.set(FOLLOW_DELETE(STORE_A), () => pending.promise);

    render(<MiniApp />);
    await screen.findByText("15% en arroz");
    fireEvent.press(screen.getAllByText(COPY.unfollow)[0]!);
    await settle();

    // Nothing leaves the screen before the server answers.
    expect(screen.getByText("15% en arroz")).toBeTruthy();
    expect(screen.getAllByText(COPY.unfollow)).toHaveLength(3);

    serveFeed([initial[2]]);
    await act(async () => {
      pending.resolve(
        reply(200, { data: { storeId: STORE_A, following: false } }),
      );
    });

    await waitFor(() =>
      expect(screen.queryAllByText("15% en arroz").length).toBe(0),
    );
    expect(screen.queryByText("Combo gaseosa")).toBeNull();
    expect(screen.getByText("Pan de yuca")).toBeTruthy();
    expect(callsTo(FEED)).toHaveLength(2);
  });

  it("an unfollow whose re-read fails keeps the data, shows the error and never fakes success", async () => {
    seed();
    const initial = [item(C1, "15% en arroz", SA), item(C3, "Pan de yuca", SB)];
    serveFeed(initial);
    routes.set(FOLLOW_DELETE(STORE_A), () => {
      routes.set(FEED, () => reply(502, { error: "x" }));
      return reply(200, { data: { storeId: STORE_A, following: false } });
    });

    render(<MiniApp />);
    await screen.findByText("15% en arroz");
    fireEvent.press(screen.getAllByText(COPY.unfollow)[0]!);

    await screen.findByText(COPY.couponsError);
    expect(screen.getByText(COPY.retry)).toBeTruthy();
    expect(screen.getByText("15% en arroz")).toBeTruthy();
    // The confirmed unfollow is not hidden: the store reads as not followed.
    expect(screen.getAllByText(COPY.follow)).toHaveLength(1);
    expect(screen.getAllByText(COPY.unfollow)).toHaveLength(1);

    serveFeed([initial[1]]);
    fireEvent.press(screen.getByText(COPY.retry));
    await waitFor(() =>
      expect(screen.queryAllByText("15% en arroz").length).toBe(0),
    );
    expect(screen.queryByText(COPY.couponsError)).toBeNull();
  });

  it("does not re-read the feed for an idempotent answer that changes nothing", async () => {
    seed();
    serveFeed([item(C1, "15% en arroz", SA, { followed: false })]);
    routes.set(FOLLOW_DELETE(STORE_A), () =>
      reply(200, { data: { storeId: STORE_A, following: false } }),
    );
    routes.set(FOLLOW_PUT(STORE_A), () =>
      reply(200, { data: { storeId: STORE_A, following: false } }),
    );

    render(<MiniApp />);
    await screen.findByText("15% en arroz");
    fireEvent.press(screen.getByText(COPY.follow));
    await settle();
    await settle();

    expect(callsTo(FOLLOW_PUT(STORE_A))).toHaveLength(1);
    expect(callsTo(FEED)).toHaveLength(1);
    expect(screen.getByText(COPY.follow)).toBeTruthy();
  });
});

describe("the session around a request", () => {
  it("a 401 refreshes once through the existing helper, retries, and rotates the stored session", async () => {
    seed();
    let feedCalls = 0;
    routes.set(FEED, (c) => {
      feedCalls += 1;
      return c.headers.Authorization === `Bearer ${acc(1)}`
        ? reply(401, { error: "expired" })
        : reply(200, { data: [item(C1, "15% en arroz", SA)] });
    });
    routes.set(REFRESH, () =>
      reply(200, {
        session: { accessToken: acc(2), refreshToken: ref(2), expiresIn: 900 },
      }),
    );

    render(<MiniApp />);
    await screen.findByText("15% en arroz");

    expect(feedCalls).toBe(2);
    expect(callsTo(REFRESH)).toHaveLength(1);
    expect(callsTo(FEED)[1]!.headers.Authorization).toBe(`Bearer ${acc(2)}`);
    expect(JSON.parse(stored()!).session.accessToken).toBe(acc(2));
  });

  it("a terminal 401 clears the session and closes the gate", async () => {
    seed();
    routes.set(FEED, () => reply(401, { error: "expired" }));
    routes.set(REFRESH, () => reply(401, { error: "revoked" }));

    render(<MiniApp />);
    await screen.findByText("auth-area:/auth/welcome");

    expect(stored()).toBeNull();
    expect(screen.queryByText(COPY.couponsError)).toBeNull();
  });

  it("a 403 for an underage customer holds the tabs and revalidates the server profile at once", async () => {
    seed();
    routes.set(FEED, () =>
      reply(403, {
        error: "You do not have access to this resource.",
        details: { eligibility: "underage" },
      }),
    );
    let profileReads = 0;
    routes.set(PROFILE_GET, () => {
      profileReads += 1;
      return reply(200, {
        data: profile(
          profileReads === 1
            ? {}
            : { birthDate: "2015-01-01", eligibility: "underage" },
        ),
      });
    });

    render(<MiniApp />);
    await screen.findByText("auth-area:/auth/profile");

    expect(profileReads).toBe(2);
    expect(callsTo(PROFILE_GET)[1]!.headers.Authorization).toBe(
      `Bearer ${acc(1)}`,
    );
    expect(screen.queryByText(COPY.couponsError)).toBeNull();
    expect(callsTo(FEED)).toHaveLength(1);
    expect(stored()).not.toBeNull();
  });

  it("a 403 for a missing birth date re-closes the gate the same way", async () => {
    seed();
    routes.set(FEED, () =>
      reply(403, { error: "x", details: { eligibility: "birth_date_required" } }),
    );
    let profileReads = 0;
    routes.set(PROFILE_GET, () => {
      profileReads += 1;
      return reply(200, {
        data: profile(
          profileReads === 1
            ? {}
            : { birthDate: null, eligibility: "birth_date_required" },
        ),
      });
    });

    render(<MiniApp />);
    await screen.findByText("auth-area:/auth/profile");
    expect(screen.queryByText(COPY.couponsError)).toBeNull();
  });

  it("a plain 403 revalidates the profile and ends at the wrong-role dead end, never a feed error", async () => {
    seed();
    routes.set(FEED, () => reply(403, { error: "x" }));
    let profileReads = 0;
    routes.set(PROFILE_GET, () => {
      profileReads += 1;
      return profileReads === 1
        ? reply(200, { data: profile() })
        : reply(403, { error: "x" });
    });

    render(<MiniApp />);
    await screen.findByText("auth-area:/auth/profile");

    expect(screen.queryByText(COPY.couponsError)).toBeNull();
    expect(probeAuth.gate.status).toBe("wrong-role");
  });

  it("a follow that finishes after logout changes no screen, no session and asks for nothing", async () => {
    seed();
    serveFeed([item(C1, "15% en arroz", SA, { followed: false })]);
    const pending = deferred();
    routes.set(FOLLOW_PUT(STORE_A), () => pending.promise);

    render(<MiniApp />);
    await screen.findByText("15% en arroz");
    fireEvent.press(screen.getByText(COPY.follow));
    await settle();
    await act(async () => {
      await probeAuth.logout();
    });
    await screen.findByText("auth-area:/auth/welcome");
    const callsBefore = calls.length;

    await act(async () => {
      pending.resolve(
        reply(200, { data: { storeId: STORE_A, following: true } }),
      );
    });
    await settle();

    expect(calls.length).toBe(callsBefore);
    expect(stored()).toBeNull();
    expect(probeAuth.user).toBeNull();
    expect(screen.queryByText("15% en arroz")).toBeNull();
  });

  it("a feed read that finishes under a newer login never shows the old customer's data", async () => {
    seed();
    const pending = deferred();
    routes.set(FEED, (c) =>
      c.headers.Authorization === `Bearer ${acc(1)}`
        ? pending.promise
        : reply(200, { data: [item(C3, "Pan de yuca", SB)] }),
    );

    render(<MiniApp />);
    await screen.findByText(COPY.loading);
    await act(async () => {
      await probeAuth.logout();
    });
    await screen.findByText("auth-area:/auth/welcome");

    const userB = user({ id: "user-2", email: "b@example.test" });
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: userB,
        session: { accessToken: acc(9), refreshToken: ref(9), expiresIn: 900 },
      }),
    );
    await act(async () => {
      await probeAuth.verifyOTP("b@example.test", "ch", "123456");
    });
    await screen.findByText("Pan de yuca");

    await act(async () => {
      pending.resolve(reply(200, { data: [item(C1, "15% en arroz", SA)] }));
    });
    await settle();

    expect(screen.queryByText("15% en arroz")).toBeNull();
    expect(screen.getByText("Pan de yuca")).toBeTruthy();
    expect(JSON.parse(stored()!).user.id).toBe("user-2");
    expect(JSON.parse(stored()!).session.accessToken).toBe(acc(9));
  });
});

describe("the protected-request seam of the provider", () => {
  const readyApp = async () => {
    seed();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(probeAuth.gate.status).toBe("ready"));
  };
  const answer = (value: string) => ({ success: true as const, data: value });

  it("hands the token to the request and returns what it answered", async () => {
    await readyApp();
    const request = jest.fn(async (_token: string) => answer("data"));

    let outcome: unknown;
    await act(async () => {
      outcome = await probeAuth.runProtected(request);
    });

    expect(request).toHaveBeenCalledWith(acc(1));
    expect(outcome).toEqual({ status: "ok", data: "data" });
  });

  it("drops an answer that arrives after logout and leaves the session signed out", async () => {
    await readyApp();
    let release!: (value: ReturnType<typeof answer>) => void;
    const request = () =>
      new Promise<ReturnType<typeof answer>>((resolve) => (release = resolve));

    let outcome: unknown;
    const running = act(async () => {
      outcome = await probeAuth.runProtected(request);
    });
    await act(async () => {
      await probeAuth.logout();
    });
    await act(async () => {
      release(answer("late"));
    });
    await running;

    expect(outcome).toEqual({ status: "ignored" });
    expect(stored()).toBeNull();
    expect(probeAuth.user).toBeNull();
  });

  it("drops an answer that arrives under a newer login and keeps the newer session", async () => {
    await readyApp();
    let release!: (value: ReturnType<typeof answer>) => void;
    const request = () =>
      new Promise<ReturnType<typeof answer>>((resolve) => (release = resolve));

    let outcome: unknown;
    const running = act(async () => {
      outcome = await probeAuth.runProtected(request);
    });
    await act(async () => {
      await probeAuth.logout();
    });
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: user({ id: "user-2", email: "b@example.test" }),
        session: { accessToken: acc(9), refreshToken: ref(9), expiresIn: 900 },
      }),
    );
    await act(async () => {
      await probeAuth.verifyOTP("b@example.test", "ch", "123456");
    });
    await act(async () => {
      release(answer("late"));
    });
    await running;

    expect(outcome).toEqual({ status: "ignored" });
    expect(JSON.parse(stored()!).user.id).toBe("user-2");
    expect(JSON.parse(stored()!).session.accessToken).toBe(acc(9));
  });

  it("never calls the request without an open client gate", async () => {
    const request = jest.fn(async () => answer("x"));

    seed(user({ role: "tendero" }));
    const first = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(probeAuth.gate.status).toBe("wrong-role"));
    let outcome: unknown;
    await act(async () => {
      outcome = await probeAuth.runProtected(request);
    });
    first.unmount();

    backing.clear();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(probeAuth.gate.status).toBe("signed-out"));
    let signedOut: unknown;
    await act(async () => {
      signedOut = await probeAuth.runProtected(request);
    });

    expect(outcome).toEqual({ status: "ignored" });
    expect(signedOut).toEqual({ status: "ignored" });
    expect(request).not.toHaveBeenCalled();
  });

  it("never calls the request for a client the profile gate still holds", async () => {
    const request = jest.fn(async () => answer("x"));
    seed();
    routes.set(PROFILE_GET, () =>
      reply(200, {
        data: profile({ birthDate: "2015-01-01", eligibility: "underage" }),
      }),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(probeAuth.gate.status).toBe("profile-required"));

    let outcome: unknown;
    await act(async () => {
      outcome = await probeAuth.runProtected(request);
    });

    expect(outcome).toEqual({ status: "ignored" });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("PRESERVE: the existing auth flows behave as before when discovery is unused", () => {
  it("OTP verify, profile load, profile save and logout make the same calls", async () => {
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: user({ fullName: "", registrationStatus: "profile_required" }),
        session: { accessToken: acc(1), refreshToken: ref(1), expiresIn: 900 },
      }),
    );
    routes.set(PROFILE_GET, () =>
      reply(200, {
        data: profile({
          fullName: "",
          birthDate: null,
          eligibility: "birth_date_required",
        }),
      }),
    );
    routes.set("PUT /api/v1/clientes/profile", () =>
      reply(200, { data: profile({ fullName: "Ana Pérez" }) }),
    );
    routes.set("POST /auth/logout", () => reply(200, {}));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await settle();
    await act(async () => {
      await probeAuth.verifyOTP("ana@example.test", "ch-1", "123456");
    });
    await waitFor(() => expect(probeAuth.gate.status).toBe("profile-required"));
    await act(async () => {
      const saved = await probeAuth.saveProfile({
        name: "Ana",
        surname: "Pérez",
        birthDate: "1990-01-01",
      });
      expect(saved).toEqual({ success: true });
    });
    await waitFor(() => expect(probeAuth.gate.status).toBe("ready"));
    await act(async () => {
      await probeAuth.logout();
    });

    expect(calls.map((c) => c.key)).toEqual([
      "POST /auth/otp/verify",
      PROFILE_GET,
      "PUT /api/v1/clientes/profile",
      "POST /auth/logout",
    ]);
    expect(stored()).toBeNull();
    expect(probeAuth.gate.status).toBe("signed-out");
  });
});
