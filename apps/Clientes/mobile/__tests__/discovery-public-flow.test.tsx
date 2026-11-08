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

import ProfileGateScreen from "@/src/features/auth/presentation/screens/ProfileGateScreen";
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

// Some cases render the real profile gate to see its approved copy and retry.
let realProfileScreen = false;

function Screen({ path }: { path: string }) {
  mockNav.path = path;
  if (path === "/") {
    return (
      <AuthGuard area="tabs">
        <InicioScreen />
      </AuthGuard>
    );
  }
  if (path === "/auth/profile" && realProfileScreen) {
    return (
      <AuthGuard area="auth">
        <ProfileGateScreen />
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
  realProfileScreen = false;
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


const logSpies = ["log", "info", "warn", "error", "debug"].map((m) =>
  jest.spyOn(console, m as "log").mockImplementation(() => {}),
);
const refreshReply = (n: number) =>
  reply(200, {
    user: user(),
    session: { accessToken: acc(n), refreshToken: ref(n), expiresIn: 900 },
  });
const later = <T,>(value: T, ms = 15) =>
  new Promise<T>((res) => setTimeout(() => res(value), ms));
const hash = () => JSON.stringify([...backing.entries()]);
const bearer = (c: Call) => c.headers.Authorization;

afterEach(() => {
  const dump = JSON.stringify(logSpies.flatMap((s) => s.mock.calls));
  expect(dump).not.toContain(`access-${tid}-`);
  expect(dump).not.toContain(`refresh-${tid}-`);
  logSpies.forEach((s) => s.mockClear());
});

describe("P1 first Inicio + copy + fields", () => {
  it("one feed without query, no location API, no followed read when non-empty, real fields only", async () => {
    const req = jest.spyOn(PermissionsAndroid, "request");
    seed();
    serveFeed([
      item(C1, "15% en arroz", SA, { claimed: true }),
      item(C2, "Combo", SB, {
        followed: false,
        coupon: {
          ...item(C2, "x", SB).coupon,
          title: "Combo",
          percentageValue: null,
          fixedAmountValue: 2.5,
          imageUrl: IMAGE_URL,
          validFrom: "2026-12-01",
          validTo: "2027-01-31",
        },
      } as any),
    ]);
    serveFollowed([]);
    render(<MiniApp />);
    expect(await screen.findByText("15% en arroz")).toBeTruthy();
    const feed = callsTo(FEED);
    expect(feed).toHaveLength(1);
    expect(feed[0]!.url).toBe("http://localhost:4300/api/v1/clientes/coupons/feed");
    expect(callsTo(FOLLOWED)).toHaveLength(0);
    expect(req).not.toHaveBeenCalled();
    const text = renderedText();
    expect(text).toContain("Sin distancia");
    expect(text).not.toMatch(/0 km|A 0 m/);
    expect(text).toContain("1 nov 2026 – 25 nov 2026");
    expect(text).toContain("1 dic 2026 – 31 ene 2027");
    expect(text).toContain("$2.50");
    expect(text).toContain("15%");
    expect(text).not.toMatch(/Reclamar|[0-9a-f]{8}-[0-9a-f]{4}|T\d\d:\d\d|Bearer|garage\.test/);
    // ephemeral URL / catalog never persisted: only the session key exists
    const all = [...backing.entries()];
    expect(all.map(([k]) => k)).toEqual([CLIENT_SESSION_STORAGE_KEY]);
    expect(hash()).not.toContain("garage.test");
    req.mockRestore();
  });

  it("distance formats from server meters", async () => {
    seed();
    serveFeed([
      item(C1, "A", store(STORE_A, "S1", { distanceMeters: 450.4, distanceKm: 0.45 })),
      item(C2, "B", store(STORE_B, "S2", { distanceMeters: 1500, distanceKm: 1.5 })),
      item(C3, "C", store("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "S3", { distanceMeters: 0, distanceKm: 0 })),
    ]);
    render(<MiniApp />);
    await screen.findByText("A");
    const t = renderedText();
    expect(t).toContain("A 450 m");
    expect(t).toContain("A 1.5 km");
    expect(t).toContain("A 0 m");
  });
});

describe("P2 empty / errors exact copy", () => {
  it.each([
    [[], [], COPY.noFollows],
    [[], [SA], COPY.empty],
  ])("empty feed %#", async (_f, followed, expected) => {
    seed();
    serveFeed(_f as any);
    serveFollowed(followed as any);
    render(<MiniApp />);
    expect(await screen.findByText(expected as string)).toBeTruthy();
  });
  it.each([400, 429, 500, 502, 503])("feed %s -> approved error, no server text, Reintentar works", async (code) => {
    seed();
    routes.set(FEED, () => reply(code, { error: "SERVER-LEAK-TEXT", details: { retryAfter: 30 } }));
    render(<MiniApp />);
    expect(await screen.findByText(COPY.couponsError)).toBeTruthy();
    expect(renderedText()).not.toContain("SERVER-LEAK-TEXT");
    expect(screen.getByText(COPY.retry)).toBeTruthy();
    serveFeed([item(C1, "ok", SA)]);
    fireEvent.press(screen.getByText(COPY.retry));
    expect(await screen.findByText("ok")).toBeTruthy();
    expect(screen.queryByText(COPY.couponsError)).toBeNull();
  });
  it("followed-list failure -> approved stores error", async () => {
    seed();
    serveFeed([]);
    routes.set(FOLLOWED, () => reply(500, {}));
    render(<MiniApp />);
    expect(await screen.findByText(COPY.storesError)).toBeTruthy();
  });
});

describe("P3 following", () => {
  const feed = (aFollowed: boolean, bFollowed = false) => [
    item(C1, "15% en arroz", SA, { followed: aFollowed }),
    item(C2, "Combo", SA, { followed: aFollowed }),
    item(C3, "Pan", SB, { followed: bFollowed }),
  ];
  it("encodes the id in the path; opposite-failure keeps state; failures leave stored bytes", async () => {
    const WEIRD = "a/b c?x";
    seed();
    serveFeed([item(C1, "T", store(WEIRD, "Weird"), { followed: false })]);
    render(<MiniApp />);
    await screen.findByText("T");
    const before = hash();
    routes.set(`PUT /api/v1/clientes/stores/${encodeURIComponent(WEIRD)}/follow`, () => reply(500, {}));
    fireEvent.press(screen.getByText(COPY.follow));
    expect(await screen.findByText(COPY.followError)).toBeTruthy();
    expect(screen.getByText(COPY.follow)).toBeTruthy();
    expect(screen.queryByText(COPY.following)).toBeNull();
    expect(hash()).toBe(before);
    const put = calls.find((c) => c.url.includes("/follow"))!;
    expect(put.url).toContain(encodeURIComponent(WEIRD));
  });
  it("disjoint stores run concurrently; same-tick duplicate is one request; both buttons covered", async () => {
    seed();
    serveFeed(feed(false));
    const a = deferred();
    const b = deferred();
    routes.set(FOLLOW_PUT(STORE_A), () => a.promise);
    routes.set(FOLLOW_PUT(STORE_B), () => b.promise);
    render(<MiniApp />);
    await screen.findByText("Pan");
    const btns = screen.getAllByText(COPY.follow);
    act(() => {
      fireEvent.press(btns[0]!);
      fireEvent.press(btns[0]!);
      fireEvent.press(btns[1]!); // other card of store A
      fireEvent.press(btns[2]!); // store B
    });
    await settle();
    expect(callsTo(FOLLOW_PUT(STORE_A))).toHaveLength(1);
    expect(callsTo(FOLLOW_PUT(STORE_B))).toHaveLength(1);
    expect(screen.queryByText(COPY.following)).toBeNull();
    serveFeed(feed(true, true));
    await act(async () => {
      a.resolve(reply(200, { data: { storeId: STORE_A, following: true } }));
      b.resolve(reply(200, { data: { storeId: STORE_B, following: true } }));
    });
    await waitFor(() => expect(screen.getAllByText(COPY.following)).toHaveLength(3));
  });
  it("idempotent follow of an already-followed store: end state shown, no failure", async () => {
    seed();
    serveFeed(feed(false));
    routes.set(FOLLOW_PUT(STORE_A), () => reply(200, { data: { storeId: STORE_A, following: true } }));
    render(<MiniApp />);
    await screen.findByText("Pan");
    serveFeed(feed(true));
    fireEvent.press(screen.getAllByText(COPY.follow)[0]!);
    await waitFor(() => expect(screen.getAllByText(COPY.following).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText(COPY.followError)).toBeNull();
  });
  it("unfollow of last followed store: fresh read -> empty -> no-follows copy", async () => {
    seed();
    serveFeed([item(C1, "15% en arroz", SA)]);
    routes.set(FOLLOW_DELETE(STORE_A), () => reply(200, { data: { storeId: STORE_A, following: false } }));
    render(<MiniApp />);
    await screen.findByText("15% en arroz");
    serveFeed([]);
    serveFollowed([]);
    fireEvent.press(screen.getByText(COPY.unfollow));
    expect(await screen.findByText(COPY.noFollows)).toBeTruthy();
    expect(screen.queryByText("15% en arroz")).toBeNull();
  });
  it("out-of-order re-reads: an older read finishing later never overwrites the newest", async () => {
    seed();
    serveFeed(feed(false));
    routes.set(FOLLOW_PUT(STORE_A), () => reply(200, { data: { storeId: STORE_A, following: true } }));
    routes.set(FOLLOW_PUT(STORE_B), () => reply(200, { data: { storeId: STORE_B, following: true } }));
    render(<MiniApp />);
    await screen.findByText("Pan");
    const slowOld = deferred();
    const fast = deferred();
    let n = 0;
    routes.set(FEED, () => (++n === 1 ? slowOld.promise : fast.promise));
    fireEvent.press(screen.getAllByText(COPY.follow)[0]!); // A -> read #1 (slow)
    await settle();
    fireEvent.press(screen.getAllByText(COPY.follow)[0]!); // B (A is already confirmed) -> read #2 (fast)
    await settle();
    await act(async () => {
      fast.resolve(reply(200, { data: feed(true, true) }));
    });
    await waitFor(() => expect(screen.getAllByText(COPY.following)).toHaveLength(3));
    await act(async () => {
      slowOld.resolve(reply(200, { data: feed(true, false) })); // stale: B not followed
    });
    await settle();
    expect(screen.getAllByText(COPY.following)).toHaveLength(3);
  });
  it("a read that fails after a confirmed follow keeps the confirmed state and last data", async () => {
    seed();
    serveFeed(feed(false));
    routes.set(FOLLOW_PUT(STORE_B), () => reply(200, { data: { storeId: STORE_B, following: true } }));
    render(<MiniApp />);
    await screen.findByText("Pan");
    routes.set(FEED, () => reply(500, {}));
    fireEvent.press(screen.getAllByText(COPY.follow)[2]!);
    expect(await screen.findByText(COPY.couponsError)).toBeTruthy();
    expect(screen.getAllByText(COPY.following)).toHaveLength(1);
    expect(screen.getByText("Pan")).toBeTruthy();
  });
});

describe("P4 session: 401 single-flight, terminal, logout, newer login", () => {
  it("two concurrent follows hit 401 -> ONE refresh, both retried with the rotated token", async () => {
    seed();
    serveFeed([item(C1, "A1", SA, { followed: false }), item(C3, "B1", SB, { followed: false })]);
    render(<MiniApp />);
    await screen.findByText("B1");
    const gate = deferred();
    for (const id of [STORE_A, STORE_B]) {
      routes.set(FOLLOW_PUT(id), (c) =>
        bearer(c) === `Bearer ${acc(1)}`
          ? reply(401, { error: "expired" })
          : reply(200, { data: { storeId: id, following: true } }),
      );
    }
    routes.set(REFRESH, () => gate.promise);
    act(() => {
      fireEvent.press(screen.getAllByText(COPY.follow)[0]!);
      fireEvent.press(screen.getAllByText(COPY.follow)[1]!);
    });
    await settle();
    await act(async () => {
      gate.resolve(refreshReply(2));
    });
    await waitFor(() => expect(callsTo(FOLLOW_PUT(STORE_B)).length).toBe(2));
    expect(callsTo(REFRESH)).toHaveLength(1);
    expect(callsTo(FOLLOW_PUT(STORE_A)).map(bearer)).toEqual([`Bearer ${acc(1)}`, `Bearer ${acc(2)}`]);
    expect(JSON.parse(stored()!).session.accessToken).toBe(acc(2));
  });
  it("terminal refresh rejection during a follow clears storage and closes the gate", async () => {
    seed();
    serveFeed([item(C1, "A1", SA, { followed: false })]);
    render(<MiniApp />);
    await screen.findByText("A1");
    routes.set(FOLLOW_PUT(STORE_A), () => reply(401, {}));
    routes.set(REFRESH, () => reply(401, { error: "invalid refresh" }));
    fireEvent.press(screen.getByText(COPY.follow));
    await screen.findByText("auth-area:/auth/welcome");
    expect(stored()).toBeNull();
    expect(screen.queryByText("A1")).toBeNull();
  });
  it("offline / 502 refresh keeps the session and shows only the follow error", async () => {
    seed();
    serveFeed([item(C1, "A1", SA, { followed: false })]);
    render(<MiniApp />);
    await screen.findByText("A1");
    const before = hash();
    routes.set(FOLLOW_PUT(STORE_A), () => reply(401, {}));
    routes.set(REFRESH, () => reply(502, {}));
    fireEvent.press(screen.getByText(COPY.follow));
    expect(await screen.findByText(COPY.followError)).toBeTruthy();
    expect(hash()).toBe(before);
  });
  it("late follow after logout then SAME user re-login applies nothing, sends nothing", async () => {
    seed();
    serveFeed([item(C1, "A1", SA, { followed: false })]);
    const late = deferred();
    routes.set(FOLLOW_PUT(STORE_A), () => late.promise);
    render(<MiniApp />);
    await screen.findByText("A1");
    fireEvent.press(screen.getByText(COPY.follow));
    await settle();
    await act(async () => { await probeAuth.logout(); });
    await screen.findByText("auth-area:/auth/welcome");
    routes.set("POST /auth/otp/verify", () => refreshReply(7));
    routes.set(FEED, () => reply(200, { data: [item(C1, "A1", SA, { followed: false })] }));
    await act(async () => { await probeAuth.verifyOTP("cliente@example.test", "ch", "123456"); });
    await screen.findByText("A1");
    const n = calls.length;
    const sessionBefore = stored();
    await act(async () => {
      late.resolve(reply(200, { data: { storeId: STORE_A, following: true } }));
    });
    await settle();
    expect(calls.length).toBe(n);
    expect(stored()).toBe(sessionBefore);
    expect(screen.queryByText(COPY.following)).toBeNull();
  });
  it("a late 401-driven refresh after logout does not revive the session", async () => {
    seed();
    serveFeed([item(C1, "A1", SA, { followed: false })]);
    render(<MiniApp />);
    await screen.findByText("A1");
    const gate = deferred();
    routes.set(FOLLOW_PUT(STORE_A), () => reply(401, {}));
    routes.set(REFRESH, () => gate.promise);
    fireEvent.press(screen.getByText(COPY.follow));
    await settle();
    await act(async () => { await probeAuth.logout(); });
    await act(async () => { gate.resolve(refreshReply(5)); });
    await settle();
    expect(stored()).toBeNull();
    expect(probeAuth.user).toBeNull();
    expect(callsTo(FOLLOW_PUT(STORE_A)).length).toBeLessThanOrEqual(1);
  });
});

describe("P5 403 handling", () => {
  const PROFILE_ERROR = "No pudimos cargar tu perfil. Intenta de nuevo";
  // Real elapsed time with a small cap: long enough for a loop to show up as
  // extra requests, short enough to keep the suite fast.
  const quiet = (ms = 250) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  // 0 ms = the answer is already batched; 15 ms = a realistic network gap.
  const LATENCIES = [0, 15];
  const answer = (ms: number, r: Reply) => (ms ? later(r, ms) : r);

  it.each(LATENCIES)(
    "403 underage + server agrees (%s ms) -> profile gate once, one feed call, no loop",
    async (ms) => {
      seed();
      routes.set(FEED, () =>
        answer(ms, reply(403, { error: "x", details: { eligibility: "underage" } })),
      );
      let reads = 0;
      routes.set(PROFILE_GET, () => {
        reads += 1;
        return answer(
          ms,
          reply(200, {
            data:
              reads === 1
                ? profile()
                : profile({ birthDate: "2015-01-01", eligibility: "underage" }),
          }),
        );
      });
      render(<MiniApp />);
      await screen.findByText("auth-area:/auth/profile");
      await quiet();

      expect(callsTo(FEED)).toHaveLength(1);
      expect(reads).toBe(2);
      expect(mockNav.redirects.filter((h) => h === "/auth/profile")).toHaveLength(1);
      expect(probeAuth.gate.status).toBe("profile-required");
      expect(screen.queryByText(COPY.couponsError)).toBeNull();
      expect(screen.queryByText(COPY.loading)).toBeNull();
    },
  );

  it.each(LATENCIES)(
    "a plain 403 while the profile still says eligible (%s ms) ends in the profile error once, then recovers only when the customer retries",
    async (ms) => {
      seed();
      realProfileScreen = true;
      let feedReads = 0;
      routes.set(PROFILE_GET, () => answer(ms, reply(200, { data: profile() })));
      routes.set(FEED, () => {
        feedReads += 1;
        return answer(
          ms,
          feedReads === 1
            ? reply(403, { error: "blocked" })
            : reply(200, { data: [item(C1, "back", SA)] }),
        );
      });
      render(<MiniApp />);
      expect(await screen.findByText(PROFILE_ERROR)).toBeTruthy();
      const keystore = hash();
      await quiet();

      // Stable: nothing reopened the tabs or asked again on its own.
      expect(callsTo(FEED)).toHaveLength(1);
      expect(callsTo(PROFILE_GET)).toHaveLength(2);
      expect(probeAuth.gate.status).toBe("profile-error");
      expect(screen.getByText(COPY.retry)).toBeTruthy();
      expect(screen.queryByText(COPY.couponsError)).toBeNull();
      expect(screen.queryByText(COPY.loading)).toBeNull();
      expect(hash()).toBe(keystore);

      fireEvent.press(screen.getByText(COPY.retry));
      expect(await screen.findByText("back")).toBeTruthy();
      expect(callsTo(FEED)).toHaveLength(2);
      expect(callsTo(PROFILE_GET)).toHaveLength(3);
    },
  );

  it.each([
    ["plain 403", { error: "You do not have access to this resource." }],
    [
      "403 with an eligible-looking code",
      { error: "x", details: { eligibility: "birth_date_required" } },
    ],
  ])(
    "a persistent %s with an eligible profile costs a bounded number of requests per customer retry",
    async (_name, body) => {
      seed();
      realProfileScreen = true;
      routes.set(PROFILE_GET, () => later(reply(200, { data: profile() })));
      routes.set(FEED, () => later(reply(403, body)));
      render(<MiniApp />);
      expect(await screen.findByText(PROFILE_ERROR)).toBeTruthy();
      await quiet(400);

      expect(callsTo(FEED)).toHaveLength(1);
      expect(callsTo(PROFILE_GET)).toHaveLength(2);
      expect(probeAuth.gate.status).toBe("profile-error");
      expect(screen.queryByText(COPY.couponsError)).toBeNull();

      // One explicit retry buys exactly one more bounded cycle.
      fireEvent.press(screen.getByText(COPY.retry));
      await waitFor(() => expect(callsTo(FEED).length).toBe(2));
      expect(await screen.findByText(PROFILE_ERROR)).toBeTruthy();
      await quiet(400);
      expect(callsTo(FEED)).toHaveLength(2);
      expect(callsTo(PROFILE_GET)).toHaveLength(4);
      expect(probeAuth.gate.status).toBe("profile-error");
    },
  );

  it("a profile that really is underage after a 403 stays closed even if the customer retries", async () => {
    seed();
    realProfileScreen = true;
    routes.set(FEED, () => reply(403, { error: "x", details: { eligibility: "underage" } }));
    let reads = 0;
    routes.set(PROFILE_GET, () => {
      reads += 1;
      return reply(200, {
        data: reads === 1 ? profile() : profile({ birthDate: "2015-01-01", eligibility: "underage" }),
      });
    });
    render(<MiniApp />);
    expect(await screen.findByText("Debes tener al menos 18 años para usar Savanhi")).toBeTruthy();
    await quiet();
    expect(callsTo(FEED)).toHaveLength(1);
    expect(probeAuth.gate.status).toBe("profile-required");
  });

  it("plain 403 and profile 403 (wrong role seen late) -> dead end, no loop", async () => {
    seed();
    routes.set(FEED, () => reply(403, { error: "You do not have access to this resource." }));
    let reads = 0;
    routes.set(PROFILE_GET, () =>
      ++reads === 1
        ? reply(200, { data: profile() })
        : reply(403, { error: "You do not have access to this resource." }),
    );
    render(<MiniApp />);
    await screen.findByText("auth-area:/auth/profile");
    await quiet();
    expect(callsTo(FEED)).toHaveLength(1);
    expect(reads).toBe(2);
    expect(probeAuth.gate.status).toBe("wrong-role");
  });

  it("a revalidation that finishes after logout applies nothing", async () => {
    seed();
    routes.set(FEED, () => reply(403, { error: "blocked" }));
    const late = deferred();
    let reads = 0;
    routes.set(PROFILE_GET, () => (++reads === 1 ? reply(200, { data: profile() }) : late.promise));
    render(<MiniApp />);
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => {
      await probeAuth.logout();
    });
    await screen.findByText("auth-area:/auth/welcome");
    await act(async () => {
      late.resolve(reply(200, { data: profile() }));
    });
    await quiet();

    expect(probeAuth.gate.status).toBe("signed-out");
    expect(stored()).toBeNull();
    expect(callsTo(FEED)).toHaveLength(1);
  });

  it("direct wrong role through the provider seam: zero calls", async () => {
    seed(user({ role: "tendero" }));
    render(<MiniApp />);
    await screen.findByText("auth-area:/auth/profile");
    const req = jest.fn();
    let r: unknown;
    await act(async () => {
      r = await probeAuth.runProtected(req);
    });
    expect(r).toEqual({ status: "ignored" });
    expect(req).not.toHaveBeenCalled();
  });
});
