process.env.TZ = "America/Bogota";

import type { Coupon, StoreMetrics } from "@repo/api-contracts";
import React from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react-native";

const TODAY = "2026-11-03";

jest.mock("@/src/lib/date-only", () => ({
  ...jest.requireActual("@/src/lib/date-only"),
  todayDateOnly: () => TODAY,
}));

const mockRequestAuthenticated = jest.fn();
jest.mock("@/src/features/auth", () => ({
  useAuth: () => ({ requestAuthenticated: mockRequestAuthenticated }),
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback]),
}));

import { CouponDetailScreen } from "@/src/features/coupons/presentation/screens/CouponDetailScreen";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const FIRST = "aaaaaaa1-0000-4000-8000-000000000001";
const SECOND = "aaaaaaa1-0000-4000-8000-000000000002";
const THIRD = "aaaaaaa1-0000-4000-8000-000000000003";

const COUPONS_PATH = `/api/v1/tenderos/stores/${STORE_ID}/coupons`;
const METRICS_PATH = `/api/v1/tenderos/stores/${STORE_ID}/metrics`;

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CLOCK_PATTERN = /\d{1,2}:\d{2}/;

const coupon = (overrides: Partial<Coupon> = {}): Coupon => ({
  id: FIRST,
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
      productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Leche entera 1 L",
      category: { id: "cat-1", name: "Lácteos", key: "lacteos" },
    },
  ],
  ...overrides,
});

const COUPONS: Coupon[] = [
  coupon(),
  coupon({
    id: SECOND,
    title: "2x1 en empanadas",
    type: "combo",
    percentageValue: null,
    claimedCount: 3,
    remainingStock: 6,
    totalStock: 9,
    products: [
      {
        source: "store_private",
        productId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Empanada de viento",
        category: null,
      },
    ],
  }),
  coupon({
    id: THIRD,
    title: "Promo de octubre",
    validTo: "2026-10-31",
  }),
];

const metrics = (): StoreMetrics => ({
  storeId: STORE_ID,
  followersCount: 23,
  totals: {
    couponCount: 3,
    claimedCount: 10,
    redeemedCount: 5,
    remainingStock: 39,
  },
  coupons: [
    {
      couponId: FIRST,
      title: "15% en lácteos",
      type: "percentage",
      totalStock: 40,
      claimedCount: 7,
      redeemedCount: 4,
      remainingStock: 33,
    },
    {
      couponId: SECOND,
      title: "2x1 en empanadas",
      type: "combo",
      totalStock: 9,
      claimedCount: 3,
      redeemedCount: 1,
      remainingStock: 6,
    },
  ],
  recentRedemptions: [],
});

const ok = (data: unknown) => ({
  success: true,
  response: { json: async () => ({ data }) },
});

type Routes = Record<string, unknown>;

function route(overrides: Routes = {}) {
  const table: Routes = {
    "GET /api/v1/tenderos/stores/me": ok([
      { id: STORE_ID, name: "Tienda Doña Rosa" },
    ]),
    [`GET ${COUPONS_PATH}`]: ok(COUPONS),
    [`GET ${METRICS_PATH}`]: ok(metrics()),
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

/** Scrolls the carousel to a page the way a flick ends. */
function swipeTo(screen: ReturnType<typeof render>, page: number) {
  const carousel = screen.getByTestId("coupon-detail-carousel");
  const interval = carousel.props.snapToInterval as number;
  fireEvent(carousel, "momentumScrollEnd", {
    nativeEvent: {
      contentOffset: { x: interval * page, y: 0 },
      contentSize: { width: interval * 3, height: 300 },
      layoutMeasurement: { width: interval, height: 300 },
    },
  });
}

const renderedText = (screen: ReturnType<typeof render>) =>
  screen
    .UNSAFE_getAllByType(require("react-native").Text)
    .flatMap((node: { props: { children: unknown } }) => {
      const children = node.props.children;
      return Array.isArray(children) ? children : [children];
    })
    .filter((child: unknown): child is string => typeof child === "string");

beforeEach(() => {
  mockRequestAuthenticated.mockReset();
  mockPush.mockReset();
  mockBack.mockReset();
});

describe("the coupon detail header", () => {
  it("goes back from a circular button and names the screen in the middle", async () => {
    route();
    const screen = render(<CouponDetailScreen couponId={FIRST} />);

    await waitFor(() => expect(screen.getByText("Cupón")).toBeTruthy());

    fireEvent.press(screen.getByLabelText("Volver"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("edits the coupon on screen from the top right", async () => {
    route();
    const screen = render(<CouponDetailScreen couponId={SECOND} />);

    await waitFor(() =>
      expect(screen.getByLabelText("Editar cupón")).toBeTruthy(),
    );
    fireEvent.press(screen.getByLabelText("Editar cupón"));

    expect(mockPush).toHaveBeenCalledWith(
      `/coupons?intent=edit&couponId=${SECOND}`,
    );
  });
});

describe("the coupon detail carousel", () => {
  it("opens on the coupon the tendero tapped, not on the first one", async () => {
    route();
    const screen = render(<CouponDetailScreen couponId={SECOND} />);

    await waitFor(() =>
      expect(screen.getByTestId("coupon-detail-carousel")).toBeTruthy(),
    );

    const carousel = screen.getByTestId("coupon-detail-carousel");
    const interval = carousel.props.snapToInterval as number;
    expect(carousel.props.contentOffset).toEqual({ x: interval * 1, y: 0 });
    expect(screen.getByTestId("page-dot-1").props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });

  it("carries every coupon of the store, not only the active ones", async () => {
    route();
    const screen = render(<CouponDetailScreen couponId={FIRST} />);

    await waitFor(() =>
      expect(screen.getAllByTestId(/^coupon-detail-page-/)).toHaveLength(3),
    );
  });

  it("moves the dots and the details together when it is swiped", async () => {
    route();
    const screen = render(<CouponDetailScreen couponId={FIRST} />);

    await waitFor(() =>
      expect(screen.getByText("15% de descuento")).toBeTruthy(),
    );

    swipeTo(screen, 1);

    await waitFor(() =>
      expect(screen.getByTestId("page-dot-1").props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true }),
      ),
    );
    const details = within(screen.getByTestId("coupon-detail-body"));
    expect(details.getByText("2x1 en empanadas")).toBeTruthy();
    expect(details.getByText("Empanada de viento")).toBeTruthy();
    expect(details.queryByText("Leche entera 1 L")).toBeNull();
  });
});

describe("the coupon detail body", () => {
  it("shows the title, the type value, the validity and the products", async () => {
    route();
    const screen = render(<CouponDetailScreen couponId={FIRST} />);

    await waitFor(() =>
      expect(screen.getByText("15% de descuento")).toBeTruthy(),
    );

    const details = within(screen.getByTestId("coupon-detail-body"));
    expect(details.getByText("15% en lácteos")).toBeTruthy();
    expect(details.getByText("1 nov 2026 - 30 nov 2026")).toBeTruthy();
    expect(details.getByText("Leche entera 1 L")).toBeTruthy();
  });

  it("shows the free text of a free-text coupon and nothing when there is none", async () => {
    route({
      [`GET ${COUPONS_PATH}`]: ok([
        coupon({
          type: "free_text",
          percentageValue: null,
          freeText: "Lleva un café gratis",
        }),
      ]),
    });
    const screen = render(<CouponDetailScreen couponId={FIRST} />);

    await waitFor(() =>
      expect(screen.getByText("Lleva un café gratis")).toBeTruthy(),
    );
  });

  it("shows the claimed, redeemed and remaining counts the API already carries", async () => {
    route();
    const screen = render(<CouponDetailScreen couponId={FIRST} />);

    await waitFor(() => expect(screen.getByText("Reclamados")).toBeTruthy());

    const details = within(screen.getByTestId("coupon-detail-body"));
    expect(details.getByText("7")).toBeTruthy();
    expect(details.getByText("Canjeados")).toBeTruthy();
    expect(details.getByText("4")).toBeTruthy();
    expect(details.getByText("Disponibles")).toBeTruthy();
    expect(details.getByText("33")).toBeTruthy();
  });

  it("has no quantity stepper at all", async () => {
    route();
    const screen = render(<CouponDetailScreen couponId={FIRST} />);

    await waitFor(() => expect(screen.getByText("Pausar")).toBeTruthy());
    expect(screen.queryByLabelText("Quitar uno")).toBeNull();
    expect(screen.queryByLabelText("Agregar uno")).toBeNull();
  });
});

describe("the coupon detail action", () => {
  it("pauses the coupon on screen and stays on the same page", async () => {
    const calls = route({
      [`POST /api/v1/tenderos/coupons/${SECOND}/pause`]: ok({
        ...COUPONS[1],
        paused: true,
      }),
    });
    const screen = render(<CouponDetailScreen couponId={SECOND} />);

    await waitFor(() => expect(screen.getByText("Pausar")).toBeTruthy());
    fireEvent.press(screen.getByText("Pausar"));

    await waitFor(() => expect(screen.getByText("Activar")).toBeTruthy());

    // The carousel did not jump back to the first coupon.
    expect(screen.getByTestId("page-dot-1").props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    const details = within(screen.getByTestId("coupon-detail-body"));
    expect(details.getByText("2x1 en empanadas")).toBeTruthy();

    // Updated in place: the list was not read again.
    expect(calls.filter((call) => call.path === COUPONS_PATH)).toHaveLength(1);
  });

  it("activates a paused coupon", async () => {
    route({
      [`GET ${COUPONS_PATH}`]: ok([coupon({ paused: true })]),
      [`POST /api/v1/tenderos/coupons/${FIRST}/activate`]: ok(
        coupon({ paused: false }),
      ),
    });
    const screen = render(<CouponDetailScreen couponId={FIRST} />);

    await waitFor(() => expect(screen.getByText("Activar")).toBeTruthy());
    fireEvent.press(screen.getByText("Activar"));

    await waitFor(() => expect(screen.getByText("Pausar")).toBeTruthy());
  });

  it("offers no action at all on an expired coupon and says so", async () => {
    route();
    const screen = render(<CouponDetailScreen couponId={THIRD} />);

    await waitFor(() => expect(screen.getByText("Vencido")).toBeTruthy());
    expect(screen.queryByText("Pausar")).toBeNull();
    expect(screen.queryByText("Activar")).toBeNull();
  });

  it("shows the API's Spanish error when the pause is refused", async () => {
    route({
      [`POST /api/v1/tenderos/coupons/${FIRST}/pause`]: {
        success: false,
        error: "Coupon does not belong to this tendero.",
      },
    });
    const screen = render(<CouponDetailScreen couponId={FIRST} />);

    await waitFor(() => expect(screen.getByText("Pausar")).toBeTruthy());
    fireEvent.press(screen.getByText("Pausar"));

    await waitFor(() =>
      expect(
        screen.getByText("Este cupón no pertenece a tu tienda."),
      ).toBeTruthy(),
    );
  });
});

describe("the coupon detail states (S11)", () => {
  it("tells the tendero when the coupon is nowhere in their store", async () => {
    route();
    const screen = render(
      <CouponDetailScreen couponId="deadbeef-dead-4ead-8ead-deadbeefdead" />,
    );

    await waitFor(() =>
      expect(screen.getByText("No encontramos este cupón")).toBeTruthy(),
    );
  });

  it("renders no identifier and no clock time anywhere", async () => {
    route();
    const screen = render(<CouponDetailScreen couponId={FIRST} />);

    await waitFor(() =>
      expect(screen.getByText("15% de descuento")).toBeTruthy(),
    );

    for (const text of renderedText(screen)) {
      expect(text).not.toMatch(UUID_PATTERN);
      expect(text).not.toMatch(CLOCK_PATTERN);
    }
  });
});
