process.env.TZ = "America/Bogota";

import type {
  Coupon,
  CouponRedemptionHistoryEntry,
  CouponRedemptionHistoryPage,
  StoreMetrics,
} from "@repo/api-contracts";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";

import HomeTab from "@/app/(tabs)/index";
import { HomeMetricsScreen } from "@/src/features/coupons/presentation/screens/HomeMetricsScreen";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const METRICS_PATH = `/api/v1/tenderos/stores/${STORE_ID}/metrics`;
const HISTORY_PATH = `/api/v1/tenderos/stores/${STORE_ID}/redemptions`;
const COUPONS_PATH = `/api/v1/tenderos/stores/${STORE_ID}/coupons`;

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CLOCK_PATTERN = /\d{1,2}:\d{2}/;

const TODAY = "2026-11-03";

/**
 * The carousel shows only the coupons that are still ACTIVE today, so the day
 * the suite is on has to be fixed; and the Home header reads the store's
 * location through the shared module, which talks to the device's geocoder.
 * Both are pinned here rather than left to the machine running the tests.
 */
jest.mock("@/src/lib/date-only", () => ({
  ...jest.requireActual("@/src/lib/date-only"),
  todayDateOnly: () => TODAY,
}));

const mockReverseGeocodeAsync = jest.fn(async (_coordinates: unknown) => [
  { city: "Quito", country: "Ecuador", region: "Pichincha", subregion: null, district: null },
]);
jest.mock("expo-location", () => ({
  reverseGeocodeAsync: (coordinates: unknown) =>
    mockReverseGeocodeAsync(coordinates),
}));

const mockRequestAuthenticated = jest.fn();
jest.mock("@/src/features/auth", () => ({
  useAuth: () => ({ requestAuthenticated: mockRequestAuthenticated }),
}));

const mockPush = jest.fn();
/**
 * The focus callbacks the screen registered, newest last. Re-running one is
 * how this suite re-enters the tab: the tendero scans a QR on another screen
 * and comes back, and the numbers have to be the new ones.
 */
const focusCallbacks: (() => void)[] = [];
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: (callback: () => void) => {
    focusCallbacks.push(callback);
    require("react").useEffect(callback, [callback]);
  },
}));

const entry = (
  overrides: Partial<CouponRedemptionHistoryEntry> = {},
): CouponRedemptionHistoryEntry => ({
  claimId: "99999999-9999-4999-8999-999999999999",
  couponTitle: "15% en lácteos",
  customerName: "Rosa",
  redeemedOn: "2026-11-03",
  ...overrides,
});

const RECENT: CouponRedemptionHistoryEntry[] = [
  entry({ claimId: "aaaaaaa1-0000-4000-8000-000000000001" }),
  entry({
    claimId: "aaaaaaa1-0000-4000-8000-000000000002",
    couponTitle: "2x1 en empanadas",
    customerName: null,
    redeemedOn: "2026-11-02",
  }),
  entry({
    claimId: "aaaaaaa1-0000-4000-8000-000000000003",
    customerName: "Carlos",
    redeemedOn: "2026-11-02",
  }),
  entry({
    claimId: "aaaaaaa1-0000-4000-8000-000000000004",
    customerName: "Ana",
    redeemedOn: "2026-11-01",
  }),
  entry({
    claimId: "aaaaaaa1-0000-4000-8000-000000000005",
    couponTitle: "2x1 en empanadas",
    customerName: "Luis",
    redeemedOn: "2026-10-31",
  }),
];

const metrics = (overrides: Partial<StoreMetrics> = {}): StoreMetrics => ({
  storeId: STORE_ID,
  followersCount: 23,
  totals: {
    couponCount: 2,
    claimedCount: 12,
    redeemedCount: 4,
    remainingStock: 37,
  },
  coupons: [
    {
      couponId: "22222222-2222-4222-8222-222222222222",
      title: "15% en lácteos",
      type: "percentage",
      totalStock: 40,
      claimedCount: 7,
      redeemedCount: 3,
      remainingStock: 33,
    },
    {
      couponId: "33333333-3333-4333-8333-333333333333",
      title: "2x1 en empanadas",
      type: "combo",
      totalStock: 9,
      claimedCount: 5,
      redeemedCount: 1,
      remainingStock: 4,
    },
  ],
  recentRedemptions: RECENT,
  ...overrides,
});

const EMPTY_METRICS = metrics({
  followersCount: 0,
  totals: {
    couponCount: 0,
    claimedCount: 0,
    redeemedCount: 0,
    remainingStock: 0,
  },
  coupons: [],
  recentRedemptions: [],
});

const historyPage = (
  overrides: Partial<CouponRedemptionHistoryPage> = {},
): CouponRedemptionHistoryPage => ({
  entries: [
    entry({
      claimId: "aaaaaaa1-0000-4000-8000-000000000006",
      customerName: "Pedro",
      redeemedOn: "2026-10-30",
    }),
  ],
  limit: 20,
  offset: 5,
  nextOffset: null,
  ...overrides,
});

const coupon = (overrides: Partial<Coupon> = {}): Coupon => ({
  id: "22222222-2222-4222-8222-222222222222",
  storeId: STORE_ID,
  type: "percentage",
  title: "15% en lácteos",
  description: null,
  freeText: null,
  percentageValue: 15,
  fixedAmountValue: null,
  validFrom: "2026-11-01",
  validTo: "2026-11-30",
  totalStock: 40,
  claimedCount: 7,
  remainingStock: 33,
  paused: false,
  imageUrl: null,
  products: [
    {
      source: "store_catalog",
      productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Leche entera 1 L",
      category: { id: "cat-1", name: "Lácteos", key: "lacteos" },
    },
  ],
  ...overrides,
});

/** One live coupon, one paused, one already expired. */
const COUPONS: Coupon[] = [
  coupon({ id: "33333333-3333-4333-8333-333333333333" }),
  coupon({
    id: "44444444-4444-4444-8444-444444444444",
    title: "2x1 en empanadas",
    paused: true,
  }),
  coupon({
    id: "55555555-5555-4555-8555-555555555555",
    title: "Promo de octubre",
    validTo: "2026-10-31",
  }),
];

const ok = (data: unknown) => ({
  success: true,
  response: { json: async () => ({ data }) },
});

type Routes = Record<string, unknown>;

/**
 * Routes the screen's real repository over a recorded fake of the
 * authenticated transport, so the screen and its repository are exercised
 * together without a network or a session — the same shape the CouponsScreen
 * suite already uses.
 */
function route(overrides: Routes = {}) {
  const table: Routes = {
    "GET /api/v1/tenderos/stores/me": ok([
      {
        id: STORE_ID,
        name: "Tienda Doña Rosa",
        address: "Av. Amazonas, Quito, Ecuador",
        latitude: -0.18,
        longitude: -78.47,
        photos: [{ id: "photo-1", url: "https://garage.test/store.jpg", contentType: "image/jpeg", position: 0 }],
      },
    ]),
    [`GET ${COUPONS_PATH}`]: ok(COUPONS),
    [`GET ${METRICS_PATH}`]: ok(metrics()),
    [`GET ${HISTORY_PATH}?limit=20&offset=5`]: ok(historyPage()),
    ...overrides,
  };
  const calls: { path: string; method: string }[] = [];

  mockRequestAuthenticated.mockImplementation(
    async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? "GET");
      calls.push({ path, method });
      return (
        table[`${method} ${path}`] ?? {
          success: false,
          error: `No route for ${method} ${path}`,
        }
      );
    },
  );

  return calls;
}

/**
 * The tab renders `MobileTopBar`, which reads the safe-area insets, so the
 * route is mounted under a provider with fixed metrics — the screen tests
 * below need none of this and render the screen directly.
 */
const SAFE_AREA = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const renderTab = () =>
  render(
    <SafeAreaProvider initialMetrics={SAFE_AREA}>
      <HomeTab />
    </SafeAreaProvider>,
  );

/** Every string the rendered tree shows the tendero. */
const renderedText = (screen: ReturnType<typeof render>) =>
  screen
    .UNSAFE_getAllByType(require("react-native").Text)
    .flatMap((node) => {
      const children = node.props.children;
      return Array.isArray(children) ? children : [children];
    })
    .filter((child): child is string => typeof child === "string");

beforeEach(() => {
  mockRequestAuthenticated.mockReset();
  mockPush.mockReset();
  focusCallbacks.length = 0;
});

describe("HomeMetricsScreen totals", () => {
  it("renders the totals and the follower count the API returned", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() => expect(screen.getByText("Reclamados")).toBeTruthy());

    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Canjeados")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("Seguidores")).toBeTruthy();
    expect(screen.getByText("23")).toBeTruthy();
    expect(screen.getByText("Disponibles")).toBeTruthy();
    expect(screen.getByText("37")).toBeTruthy();
  });

  it("reads the whole tab with ONE metrics request", async () => {
    const calls = route();
    render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(calls.filter((call) => call.path === METRICS_PATH)).toHaveLength(1),
    );
    expect(
      calls.filter((call) => call.path.startsWith(HISTORY_PATH)),
    ).toHaveLength(0);
  });

  it("renders the per-coupon funnel with its title and its type", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(screen.getAllByText("15% en lácteos").length).toBeGreaterThan(0),
    );

    expect(screen.getByText("% de descuento")).toBeTruthy();
    expect(screen.getByText("2x1 / Combo")).toBeTruthy();
    expect(screen.getByText("7 reclamados · 3 canjeados")).toBeTruthy();
    expect(screen.getByText("5 reclamados · 1 canjeado")).toBeTruthy();
  });
});

describe("HomeMetricsScreen redemption history", () => {
  it("renders the timeline with the coupon, the customer and the date only", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(screen.getByText("Rosa · 3 nov 2026")).toBeTruthy(),
    );

    expect(screen.getByText("Carlos · 2 nov 2026")).toBeTruthy();
    expect(screen.getByText("Luis · 31 oct 2026")).toBeTruthy();
  });

  it("names a customer with no profile in Spanish instead of inventing one", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(screen.getByText("Cliente sin nombre · 2 nov 2026")).toBeTruthy(),
    );
  });

  it("loads more history sending only limit and offset", async () => {
    const calls = route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() => expect(screen.getByText("Ver más canjes")).toBeTruthy());
    fireEvent.press(screen.getByText("Ver más canjes"));

    await waitFor(() =>
      expect(screen.getByText("Pedro · 30 oct 2026")).toBeTruthy(),
    );

    const historyPaths = calls
      .filter((call) => call.path.startsWith(HISTORY_PATH))
      .map((call) => call.path);
    expect(historyPaths).toEqual([`${HISTORY_PATH}?limit=20&offset=5`]);
    // The backend query is strict: anything beyond limit and offset is a 400.
    expect(historyPaths.map((path) => path.split("?")[1])).toEqual([
      "limit=20&offset=5",
    ]);
  });

  it("stops offering more history once the last page came back", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() => expect(screen.getByText("Ver más canjes")).toBeTruthy());
    fireEvent.press(screen.getByText("Ver más canjes"));

    await waitFor(() =>
      expect(screen.getByText("Pedro · 30 oct 2026")).toBeTruthy(),
    );
    expect(screen.queryByText("Ver más canjes")).toBeNull();
  });

  it("never offers more history when the store has fewer redemptions than one preview", async () => {
    route({
      [`GET ${METRICS_PATH}`]: ok(
        metrics({ recentRedemptions: RECENT.slice(0, 2) }),
      ),
    });
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(screen.getByText("Rosa · 3 nov 2026")).toBeTruthy(),
    );
    expect(screen.queryByText("Ver más canjes")).toBeNull();
  });
});

describe("HomeMetricsScreen states", () => {
  it("shows a loading line before the metrics arrive", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    expect(screen.getByText("Cargando tu tienda...")).toBeTruthy();

    // Let the read settle, so the loading state is asserted on its own and
    // the resolution does not land outside `act`.
    await waitFor(() =>
      expect(screen.queryByText("Cargando tu tienda...")).toBeNull(),
    );
  });

  /**
   * The metrics block still says the store has nothing to measure; the SINGLE
   * invite to create now lives on the carousel above it, so the screen no
   * longer shows two black pills for one action (S14).
   */
  it("points a brand new store at creating its first coupon", async () => {
    route({
      [`GET ${METRICS_PATH}`]: ok(EMPTY_METRICS),
      [`GET ${COUPONS_PATH}`]: ok([]),
    });
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() => expect(screen.getByText("Sin cupones aún")).toBeTruthy());
    expect(
      screen.getByText(
        "Crea tu primer cupón para empezar a medir reclamos y canjes.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Crear cupón")).toBeNull();

    fireEvent.press(screen.getByText("Crear mi primer cupón"));
    expect(mockPush).toHaveBeenCalledWith("/coupons?intent=new");
  });

  it("shows the Spanish failure and retries from the screen", async () => {
    const calls = route({
      [`GET ${METRICS_PATH}`]: {
        success: false,
        error: "Store does not belong to this tendero.",
      },
    });
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(
        screen.getByText("Esta tienda no pertenece a tu cuenta."),
      ).toBeTruthy(),
    );

    route();
    fireEvent.press(screen.getByText("Reintentar"));

    await waitFor(() => expect(screen.getByText("Seguidores")).toBeTruthy());
    expect(calls.length).toBeGreaterThan(0);
  });

  it("tells a tendero with no store to finish registering", async () => {
    route({ "GET /api/v1/tenderos/stores/me": ok([]) });
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(screen.getByText("Sin tienda disponible")).toBeTruthy(),
    );
  });

  it("refreshes on focus so a redemption shows up after scanning", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() => expect(screen.getByText("12")).toBeTruthy());

    route({
      [`GET ${METRICS_PATH}`]: ok(
        metrics({
          totals: {
            couponCount: 2,
            claimedCount: 12,
            redeemedCount: 5,
            remainingStock: 37,
          },
          recentRedemptions: [
            entry({
              claimId: "aaaaaaa1-0000-4000-8000-00000000000f",
              customerName: "Marta",
              redeemedOn: "2026-11-04",
            }),
            ...RECENT,
          ],
        }),
      ),
    });

    const refocus = focusCallbacks.at(-1);
    expect(refocus).toBeDefined();
    await act(async () => {
      refocus?.();
    });

    await waitFor(() =>
      expect(screen.getByText("Marta · 4 nov 2026")).toBeTruthy(),
    );
    expect(screen.getByText("5")).toBeTruthy();
  });
});

describe("the Home header (S14)", () => {
  it("shows the store's photo, its name and where it is", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(screen.getByText("Tienda Doña Rosa")).toBeTruthy(),
    );
    expect(screen.getByTestId("store-photo").props.source).toEqual({
      uri: "https://garage.test/store.jpg",
    });
    await waitFor(() => expect(screen.getByText("Quito, Ecuador")).toBeTruthy());
  });

  it("falls back to the store's initial when it has no photo", async () => {
    route({
      "GET /api/v1/tenderos/stores/me": ok([
        { id: STORE_ID, name: "Tienda Doña Rosa" },
      ]),
    });
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() => expect(screen.getByTestId("store-initial")).toBeTruthy());
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.queryByTestId("store-photo")).toBeNull();
  });

  it("offers no notifications, because there are none", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(screen.getByText("Tienda Doña Rosa")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Notificaciones")).toBeNull();
  });
});

describe("the Home headline and shortcuts (S14)", () => {
  it("counts the ACTIVE coupons, in the plural", async () => {
    route({
      [`GET ${COUPONS_PATH}`]: ok([
        ...COUPONS,
        coupon({ id: "66666666-6666-4666-8666-666666666666", title: "Otro" }),
      ]),
    });
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() => expect(screen.getByText("Tienes")).toBeTruthy());
    expect(screen.getByText("2 cupones activos")).toBeTruthy();
  });

  it("uses the singular for exactly one active coupon", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() => expect(screen.getByText("Tienes")).toBeTruthy());
    expect(screen.getByText("1 cupón activo")).toBeTruthy();
  });

  it("invites a store with nothing live to create its first coupon", async () => {
    route({ [`GET ${COUPONS_PATH}`]: ok([]) });
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() => expect(screen.getByText("Crea tu")).toBeTruthy());
    expect(screen.getByText("primer cupón")).toBeTruthy();
  });

  it("opens the new-coupon form from the round black button", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(screen.getByTestId("create-coupon-button")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("create-coupon-button"));

    expect(mockPush).toHaveBeenCalledWith("/coupons?intent=new");
  });

  it("offers four shortcuts that all go somewhere that exists", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() => expect(screen.getByText("Mis cupones")).toBeTruthy());

    const shortcuts: [string, string][] = [
      ["Escanear cupón", "/scanner"],
      ["Mis cupones", "/coupons"],
      ["Revisar inventario", "/products"],
      ["Agregar producto", "/products?intent=add"],
    ];
    for (const [label, target] of shortcuts) {
      mockPush.mockClear();
      fireEvent.press(screen.getByText(label));
      expect(mockPush).toHaveBeenCalledWith(target);
    }
  });

  it("does not repeat the round button's own action in the grid", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() => expect(screen.getByText("Mis cupones")).toBeTruthy());
    expect(screen.queryByText("Nuevo cupón")).toBeNull();
  });
});

describe("the Home carousel of active coupons (S14)", () => {
  it("carries the active coupons and neither the paused nor the expired one", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(screen.getAllByTestId("coupon-highlight-card")).toHaveLength(1),
    );

    // Scoped to the carousel on purpose: the paused coupon's title also
    // appears in the funnel and in the history below, which is correct —
    // those are facts about the past and are not filtered by today.
    const carousel = within(screen.getByTestId("active-coupons-carousel"));
    expect(carousel.getByText("15% en lácteos")).toBeTruthy();
    expect(carousel.queryByText("2x1 en empanadas")).toBeNull();
    expect(carousel.queryByText("Promo de octubre")).toBeNull();
  });

  it("shows the coupon's big value and opens its detail", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() => expect(screen.getByText("-15%")).toBeTruthy());

    fireEvent.press(screen.getByTestId("open-coupon-detail"));
    expect(mockPush).toHaveBeenCalledWith(
      "/coupon/33333333-3333-4333-8333-333333333333",
    );
  });

  it("draws the category icon when the coupon has no photo", async () => {
    route();
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(screen.getByTestId("coupon-highlight-icon")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coupon-highlight-photo")).toBeNull();
  });

  it("draws the coupon's own photo when it has one", async () => {
    route({
      [`GET ${COUPONS_PATH}`]: ok([
        coupon({
          id: "33333333-3333-4333-8333-333333333333",
          imageUrl: "https://garage.test/coupon.jpg",
        }),
      ]),
    });
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(screen.getByTestId("coupon-highlight-photo")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coupon-highlight-icon")).toBeNull();
  });

  it("offers one card inviting the first coupon when nothing is active", async () => {
    route({ [`GET ${COUPONS_PATH}`]: ok([]) });
    const screen = render(<HomeMetricsScreen />);

    await waitFor(() =>
      expect(screen.getByText("Aún no tienes cupones activos")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coupon-highlight-card")).toBeNull();

    fireEvent.press(screen.getByText("Crear mi primer cupón"));
    expect(mockPush).toHaveBeenCalledWith("/coupons?intent=new");
  });
});

describe("the Home tab (S11)", () => {
  it("renders no mock data at all", async () => {
    route();
    const screen = renderTab();

    await waitFor(() => expect(screen.getByText("Seguidores")).toBeTruthy());

    expect(screen.queryByText("Arroz 1kg")).toBeNull();
    expect(screen.queryByText("Aceite 900ml")).toBeNull();
    expect(screen.queryByText("Gaseosa 500ml")).toBeNull();
    expect(screen.queryByText("Ventas del dia")).toBeNull();
    expect(screen.queryByText("Ganancia estimada")).toBeNull();
    expect(screen.queryByText("Productos mas vendidos")).toBeNull();
    expect(screen.queryByText("Alertas importantes")).toBeNull();
  });

  it("renders no identifier and no clock time anywhere", async () => {
    route();
    const screen = renderTab();

    await waitFor(() => expect(screen.getByText("Seguidores")).toBeTruthy());

    for (const text of renderedText(screen)) {
      expect(text).not.toMatch(UUID_PATTERN);
      expect(text).not.toMatch(CLOCK_PATTERN);
    }
  });
});
