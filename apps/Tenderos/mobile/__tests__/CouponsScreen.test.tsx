process.env.TZ = "America/Bogota";

import type { Coupon } from "@repo/api-contracts";
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

/**
 * The validity window is picked on a calendar now (S13), and a calendar
 * disables the past, so the day the suite "is on" has to be fixed. It is
 * pinned to the first day of the window these fixtures use, which keeps every
 * date in this file exactly what it was before the calendar replaced the two
 * text inputs.
 */
jest.mock("@/src/lib/date-only", () => ({
  ...jest.requireActual("@/src/lib/date-only"),
  todayDateOnly: () => "2026-01-01",
}));

import { CouponsScreen } from "@/src/features/coupons/presentation/screens/CouponsScreen";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const COUPON_ID = "22222222-2222-4222-8222-222222222222";
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const mockRequestAuthenticated = jest.fn();
jest.mock("@/src/features/auth", () => ({
  useAuth: () => ({ requestAuthenticated: mockRequestAuthenticated }),
}));
const mockPush = jest.fn();
/**
 * The screen now reads where it was opened FROM: the Home tab's round black
 * button asks for the create form, and the coupon detail's edit action asks
 * for one stored coupon (S14). The params are per-test, so the mock reads a
 * variable the test sets.
 */
let mockSearchParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockSearchParams,
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback]),
}));

const mockLaunchImageLibraryAsync = jest.fn();
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibraryAsync(...args),
}));

const ok = (data: unknown) => ({
  success: true,
  response: { json: async () => ({ data }) },
});

const coupon = (overrides: Partial<Coupon> = {}): Coupon => ({
  id: COUPON_ID,
  storeId: STORE_ID,
  type: "percentage",
  title: "15% en lácteos",
  description: null,
  freeText: null,
  percentageValue: 15,
  fixedAmountValue: null,
  validFrom: "2026-01-01",
  validTo: "2026-01-31",
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

const CATALOG_ITEM = {
  id: "assignment-1",
  product: {
    commercialName: "Leche entera 1 L",
    categoryId: "cat-1",
    categoryName: "Lácteos",
  },
  active: true,
};

const PRIVATE_ITEM = {
  id: "private-1",
  name: "Empanadas de la casa",
  categoryId: null,
  categoryName: null,
  active: true,
};

type Routes = Record<string, unknown>;

/**
 * Routes the screen's real repository over a recorded fake of the
 * authenticated transport, so the screen, its use cases and its repository are
 * all exercised without a network or a session — the same shape the
 * ProductsWorkspace suite already uses.
 */
function route(
  coupons: Coupon[],
  overrides: Routes = {},
  options: { products?: boolean } = { products: true },
) {
  const defaults: Routes = {
    "GET /api/v1/tenderos/stores/me": ok([
      { id: STORE_ID, name: "Tienda Doña Rosa" },
    ]),
    [`GET /api/v1/tenderos/stores/${STORE_ID}/coupons`]: ok(coupons),
    [`GET /api/v1/tenderos/stores/${STORE_ID}/catalog`]: ok(
      options.products === false ? [] : [CATALOG_ITEM],
    ),
    [`GET /api/v1/tenderos/stores/${STORE_ID}/products`]: ok(
      options.products === false ? [] : [PRIVATE_ITEM],
    ),
  };
  const table = { ...defaults, ...overrides };
  const calls: { path: string; method: string; body: unknown }[] = [];

  mockRequestAuthenticated.mockImplementation(
    async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? "GET");
      calls.push({
        path,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
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

const sent = (
  calls: { path: string; method: string; body: unknown }[],
  method: string,
  path: string,
) => calls.find((call) => call.method === method && call.path === path);

/**
 * Chooses the fixtures' validity window the way the tendero now does it: two
 * taps on the calendar, in the month it already opens on (S13).
 */
function pickValidity(screen: ReturnType<typeof render>) {
  fireEvent.press(screen.getByTestId("calendar-day-2026-01-01"));
  fireEvent.press(screen.getByTestId("calendar-day-2026-01-31"));
}

async function openForm(screen: ReturnType<typeof render>) {
  await waitFor(() => expect(screen.getByText("Nuevo cupón")).toBeTruthy());
  fireEvent.press(screen.getByText("Nuevo cupón"));
  await waitFor(() =>
    expect(screen.getByPlaceholderText("Título del cupón")).toBeTruthy(),
  );
}

beforeEach(() => {
  mockRequestAuthenticated.mockReset();
  mockLaunchImageLibraryAsync.mockReset();
  mockPush.mockReset();
  mockSearchParams = {};
});

describe("CouponsScreen navigation (S14)", () => {
  it("opens the detail when a card is tapped", async () => {
    route([coupon()]);
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("15% en lácteos")).toBeTruthy());
    fireEvent.press(screen.getByTestId("coupon-card"));

    expect(mockPush).toHaveBeenCalledWith(`/coupon/${COUPON_ID}`);
  });

  it("keeps pause and activate reachable from the card itself", async () => {
    const calls = route([coupon()]);
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("Pausar")).toBeTruthy());
    fireEvent.press(screen.getByText("Pausar"));

    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.path === `/api/v1/tenderos/coupons/${COUPON_ID}/pause`,
        ),
      ).toBe(true),
    );
    // Pausing is not a navigation: it must not open the detail.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("opens the create form straight away when the Home button sent it", async () => {
    mockSearchParams = { intent: "new" };
    route([coupon()]);
    const screen = render(<CouponsScreen />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Título del cupón")).toBeTruthy(),
    );
    expect(screen.getByText("Nuevo cupón")).toBeTruthy();
  });

  it("opens the edit form on the coupon the detail named", async () => {
    mockSearchParams = { intent: "edit", couponId: COUPON_ID };
    route([coupon()]);
    const screen = render(<CouponsScreen />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Título del cupón").props.value).toBe(
        "15% en lácteos",
      ),
    );
    expect(screen.getByText("Editar cupón")).toBeTruthy();
  });

  it("ignores an intent naming a coupon that is not in the store", async () => {
    mockSearchParams = { intent: "edit", couponId: "99999999-9999-4999-8999-999999999999" };
    route([coupon()]);
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("15% en lácteos")).toBeTruthy());
    expect(screen.queryByPlaceholderText("Título del cupón")).toBeNull();
  });
});

describe("CouponsScreen list", () => {
  it("shows a loading state before the coupons arrive", async () => {
    route([coupon()]);
    const screen = render(<CouponsScreen />);

    expect(screen.getByText("Cargando cupones...")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("15% en lácteos")).toBeTruthy());
  });

  it("renders the title, the type value, the validity and the counts", async () => {
    route([coupon()]);
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("15% en lácteos")).toBeTruthy());
    expect(screen.getByText("15% de descuento")).toBeTruthy();
    expect(screen.getByText("1 ene 2026 - 31 ene 2026")).toBeTruthy();
    expect(screen.getByText("7 reclamados · 33 disponibles")).toBeTruthy();
    expect(screen.getByText("Leche entera 1 L")).toBeTruthy();
  });

  it("renders the coupon photo when it has one", async () => {
    route([coupon({ imageUrl: "https://garage.test/coupons/one.jpg" })]);
    const screen = render(<CouponsScreen />);

    await waitFor(() =>
      expect(screen.getByTestId("coupon-photo")).toBeTruthy(),
    );
    expect(screen.getByTestId("coupon-photo").props.source).toEqual({
      uri: "https://garage.test/coupons/one.jpg",
    });
    expect(screen.queryByTestId("coupon-category-icon")).toBeNull();
  });

  /** S5 display acceptance: the category icon of the FIRST product. */
  it("falls back to the first product's category icon with no photo", async () => {
    route([coupon({ imageUrl: null })]);
    const screen = render(<CouponsScreen />);

    await waitFor(() =>
      expect(screen.getByTestId("coupon-category-icon")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coupon-photo")).toBeNull();
  });

  it("marks a paused coupon with its own chip", async () => {
    route([coupon({ paused: true })]);
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("En pausa")).toBeTruthy());
  });

  it("shows an empty state when the store has no coupons", async () => {
    route([]);
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("Sin cupones")).toBeTruthy());
    expect(screen.queryByText("Cargando cupones...")).toBeNull();
  });

  it("shows the API's Spanish error and retries", async () => {
    const calls = route([], {
      [`GET /api/v1/tenderos/stores/${STORE_ID}/coupons`]: {
        success: false,
        error: "Store does not belong to this tendero.",
      },
    });
    const screen = render(<CouponsScreen />);

    await waitFor(() =>
      expect(
        screen.getByText("Esta tienda no pertenece a tu cuenta."),
      ).toBeTruthy(),
    );

    const before = calls.length;
    fireEvent.press(screen.getByText("Reintentar"));
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
  });

  it("tells the tendero to finish registering when there is no store", async () => {
    route([], { "GET /api/v1/tenderos/stores/me": ok([]) });
    const screen = render(<CouponsScreen />);

    await waitFor(() =>
      expect(screen.getByText("Sin tienda disponible")).toBeTruthy(),
    );
  });

  /** S11 — no screen renders a UUID or any internal identifier. */
  it("renders no identifier anywhere", async () => {
    route([
      coupon({ imageUrl: "https://garage.test/coupons/one.jpg" }),
      coupon({
        id: "33333333-3333-4333-8333-333333333333",
        title: "Combo del día",
        type: "combo",
        percentageValue: null,
        paused: true,
      }),
    ]);
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("Combo del día")).toBeTruthy());

    const texts = screen
      .root!.findAllByType("Text" as never)
      .map((node: { props: { children?: unknown } }) =>
        JSON.stringify(node.props.children),
      )
      .join(" ");
    expect(texts).not.toMatch(UUID_PATTERN);
    expect(texts).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("CouponsScreen pause and activate", () => {
  it("pauses an active coupon and reloads the list", async () => {
    const calls = route([coupon()], {
      [`POST /api/v1/tenderos/coupons/${COUPON_ID}/pause`]: ok(
        coupon({ paused: true }),
      ),
    });
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("Pausar")).toBeTruthy());
    fireEvent.press(screen.getByText("Pausar"));

    await waitFor(() =>
      expect(
        sent(calls, "POST", `/api/v1/tenderos/coupons/${COUPON_ID}/pause`),
      ).toBeDefined(),
    );
  });

  it("activates a paused coupon", async () => {
    const calls = route([coupon({ paused: true })], {
      [`POST /api/v1/tenderos/coupons/${COUPON_ID}/activate`]: ok(coupon()),
    });
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("Activar")).toBeTruthy());
    fireEvent.press(screen.getByText("Activar"));

    await waitFor(() =>
      expect(
        sent(calls, "POST", `/api/v1/tenderos/coupons/${COUPON_ID}/activate`),
      ).toBeDefined(),
    );
  });

  it("shows the API's Spanish error when the pause is refused", async () => {
    route([coupon()], {
      [`POST /api/v1/tenderos/coupons/${COUPON_ID}/pause`]: {
        success: false,
        error: "Coupon does not belong to this tendero.",
      },
    });
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("Pausar")).toBeTruthy());
    fireEvent.press(screen.getByText("Pausar"));

    await waitFor(() =>
      expect(
        screen.getByText("Este cupón no pertenece a tu tienda."),
      ).toBeTruthy(),
    );
  });
});

describe("CouponsScreen create", () => {
  it("creates a percentage coupon with one product", async () => {
    const calls = route([], {
      [`POST /api/v1/tenderos/stores/${STORE_ID}/coupons`]: ok(coupon()),
    });
    const screen = render(<CouponsScreen />);
    await openForm(screen);

    fireEvent.press(screen.getByText("% de descuento"));
    fireEvent.changeText(
      screen.getByPlaceholderText("Título del cupón"),
      "15% en lácteos",
    );
    fireEvent.changeText(screen.getByPlaceholderText("Descuento (1 a 100)"), "15");
    pickValidity(screen);
    fireEvent.changeText(screen.getByPlaceholderText("Stock total"), "40");
    fireEvent.press(screen.getByText("Leche entera 1 L"));
    fireEvent.press(screen.getByText("Guardar cupón"));

    await waitFor(() =>
      expect(
        sent(calls, "POST", `/api/v1/tenderos/stores/${STORE_ID}/coupons`),
      ).toBeDefined(),
    );
    expect(
      sent(calls, "POST", `/api/v1/tenderos/stores/${STORE_ID}/coupons`)?.body,
    ).toEqual({
      type: "percentage",
      title: "15% en lácteos",
      validFrom: "2026-01-01",
      validTo: "2026-01-31",
      totalStock: 40,
      paused: false,
      percentageValue: 15,
      products: [{ source: "store_catalog", productId: "assignment-1" }],
    });
  });

  it("creates a combo across both product sources", async () => {
    const calls = route([], {
      [`POST /api/v1/tenderos/stores/${STORE_ID}/coupons`]: ok(
        coupon({ type: "combo", percentageValue: null }),
      ),
    });
    const screen = render(<CouponsScreen />);
    await openForm(screen);

    fireEvent.press(screen.getByText("2x1 / Combo"));
    fireEvent.changeText(
      screen.getByPlaceholderText("Título del cupón"),
      "Combo del día",
    );
    pickValidity(screen);
    fireEvent.changeText(screen.getByPlaceholderText("Stock total"), "10");
    fireEvent.press(screen.getByText("Leche entera 1 L"));
    fireEvent.press(screen.getByText("Empanadas de la casa"));
    fireEvent.press(screen.getByText("Guardar cupón"));

    await waitFor(() =>
      expect(
        sent(calls, "POST", `/api/v1/tenderos/stores/${STORE_ID}/coupons`)?.body,
      ).toEqual({
        type: "combo",
        title: "Combo del día",
        validFrom: "2026-01-01",
        validTo: "2026-01-31",
        totalStock: 10,
        paused: false,
        products: [
          { source: "store_catalog", productId: "assignment-1" },
          { source: "store_private", productId: "private-1" },
        ],
      }),
    );
  });

  /** S5 — a non-combo type keeps exactly one product selected. */
  it("replaces the product instead of adding a second one for a percentage", async () => {
    const calls = route([], {
      [`POST /api/v1/tenderos/stores/${STORE_ID}/coupons`]: ok(coupon()),
    });
    const screen = render(<CouponsScreen />);
    await openForm(screen);

    fireEvent.press(screen.getByText("% de descuento"));
    fireEvent.changeText(screen.getByPlaceholderText("Título del cupón"), "Uno");
    fireEvent.changeText(screen.getByPlaceholderText("Descuento (1 a 100)"), "10");
    pickValidity(screen);
    fireEvent.changeText(screen.getByPlaceholderText("Stock total"), "5");
    fireEvent.press(screen.getByText("Leche entera 1 L"));
    fireEvent.press(screen.getByText("Empanadas de la casa"));
    fireEvent.press(screen.getByText("Guardar cupón"));

    await waitFor(() =>
      expect(
        sent(calls, "POST", `/api/v1/tenderos/stores/${STORE_ID}/coupons`)?.body,
      ).toMatchObject({
        products: [{ source: "store_private", productId: "private-1" }],
      }),
    );
  });

  it("refuses to send a coupon with no product and says why (S5)", async () => {
    const calls = route([]);
    const screen = render(<CouponsScreen />);
    await openForm(screen);

    fireEvent.press(screen.getByText("% de descuento"));
    fireEvent.changeText(screen.getByPlaceholderText("Título del cupón"), "Sin producto");
    fireEvent.changeText(screen.getByPlaceholderText("Descuento (1 a 100)"), "10");
    pickValidity(screen);
    fireEvent.changeText(screen.getByPlaceholderText("Stock total"), "5");
    fireEvent.press(screen.getByText("Guardar cupón"));

    await waitFor(() =>
      expect(
        screen.getByText("Elige al menos 1 producto para el cupón."),
      ).toBeTruthy(),
    );
    expect(
      sent(calls, "POST", `/api/v1/tenderos/stores/${STORE_ID}/coupons`),
    ).toBeUndefined();
  });

  /**
   * The inverted window this case used to type is now UNREACHABLE: the
   * calendar restarts the range when the second tap lands before the start
   * (S13), so the form can no longer be put in that state from the UI. What
   * remains reachable is a HALF-chosen window, and that is what must not be
   * saved. The inverted rule itself still lives in `validateCouponForm` and is
   * pinned directly in `coupon-form.test.ts`.
   */
  it("cannot be put in an inverted validity window at all (S6, S13)", async () => {
    const calls = route([]);
    const screen = render(<CouponsScreen />);
    await openForm(screen);

    fireEvent.press(screen.getByText("2x1 / Combo"));
    fireEvent.changeText(screen.getByPlaceholderText("Título del cupón"), "Al revés");
    fireEvent.changeText(screen.getByPlaceholderText("Stock total"), "5");
    fireEvent.press(screen.getByText("Leche entera 1 L"));

    // Last day first, then an earlier one: the range restarts instead of
    // inverting, which leaves the window open and the coupon unsaveable.
    fireEvent.press(screen.getByTestId("calendar-day-2026-01-31"));
    fireEvent.press(screen.getByTestId("calendar-day-2026-01-01"));
    expect(screen.getByText("Desde 1 ene 2026 · elige el último día")).toBeTruthy();

    fireEvent.press(screen.getByText("Guardar cupón"));

    await waitFor(() =>
      expect(
        screen.getByText("Usa el formato AAAA-MM-DD en ambas fechas."),
      ).toBeTruthy(),
    );
    expect(
      sent(calls, "POST", `/api/v1/tenderos/stores/${STORE_ID}/coupons`),
    ).toBeUndefined();
  });

  it("shows the API's Spanish error when the create is refused", async () => {
    route([], {
      [`POST /api/v1/tenderos/stores/${STORE_ID}/coupons`]: {
        success: false,
        error: "Every coupon product must belong to this store.",
      },
    });
    const screen = render(<CouponsScreen />);
    await openForm(screen);

    fireEvent.press(screen.getByText("2x1 / Combo"));
    fireEvent.changeText(screen.getByPlaceholderText("Título del cupón"), "Combo");
    pickValidity(screen);
    fireEvent.changeText(screen.getByPlaceholderText("Stock total"), "5");
    fireEvent.press(screen.getByText("Leche entera 1 L"));
    fireEvent.press(screen.getByText("Guardar cupón"));

    await waitFor(() =>
      expect(
        screen.getByText("Cada producto del cupón debe ser de esta tienda."),
      ).toBeTruthy(),
    );
  });

  it("uploads a chosen photo and sends its object key with the coupon", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/coupon.jpg" }],
    });
    const objectKey = `coupons/${STORE_ID}/one.jpg`;
    const calls = route([], {
      [`POST /api/v1/tenderos/stores/${STORE_ID}/coupon-image-uploads`]: ok({
        objectKey,
        uploadUrl: "https://garage.test/upload/1",
        contentType: "image/jpeg",
        contentLength: 4,
        expiresInSeconds: 900,
      }),
      [`POST /api/v1/tenderos/stores/${STORE_ID}/coupons`]: ok(coupon()),
    });

    const fetchMock = jest
      .fn()
      .mockImplementation(async (url: string) =>
        url.startsWith("file://")
          ? {
              ok: true,
              headers: { get: () => "image/jpeg" },
              arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
            }
          : { ok: true },
      );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      const screen = render(<CouponsScreen />);
      await openForm(screen);

      fireEvent.press(screen.getByText("2x1 / Combo"));
      fireEvent.changeText(screen.getByPlaceholderText("Título del cupón"), "Con foto");
      pickValidity(screen);
      fireEvent.changeText(screen.getByPlaceholderText("Stock total"), "5");
      fireEvent.press(screen.getByText("Leche entera 1 L"));
      fireEvent.press(screen.getByText("Agregar foto"));

      await waitFor(() => expect(screen.getByText("Foto lista")).toBeTruthy());
      fireEvent.press(screen.getByText("Guardar cupón"));

      await waitFor(() =>
        expect(
          sent(calls, "POST", `/api/v1/tenderos/stores/${STORE_ID}/coupons`)
            ?.body,
        ).toMatchObject({ imageObjectKey: objectKey }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "https://garage.test/upload/1",
        expect.objectContaining({ method: "PUT" }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("CouponsScreen edit", () => {
  it("prefills the form from the coupon and patches the coupon route", async () => {
    const calls = route([coupon()], {
      [`PATCH /api/v1/tenderos/coupons/${COUPON_ID}`]: ok(
        coupon({ totalStock: 60 }),
      ),
    });
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("Editar")).toBeTruthy());
    fireEvent.press(screen.getByText("Editar"));

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Título del cupón").props.value).toBe(
        "15% en lácteos",
      ),
    );
    expect(screen.getByPlaceholderText("Descuento (1 a 100)").props.value).toBe(
      "15",
    );
    // The window is no longer a text field: it is the calendar's own
    // selection, shown through the shared date-only helper (S13, S11).
    expect(screen.getByText("1 ene 2026 - 31 ene 2026")).toBeTruthy();
    expect(
      screen.getByTestId("calendar-day-2026-01-01").props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.getByPlaceholderText("Stock total").props.value).toBe("40");

    fireEvent.changeText(screen.getByPlaceholderText("Stock total"), "60");
    fireEvent.press(screen.getByText("Guardar cupón"));

    await waitFor(() =>
      expect(
        sent(calls, "PATCH", `/api/v1/tenderos/coupons/${COUPON_ID}`)?.body,
      ).toMatchObject({ type: "percentage", totalStock: 60 }),
    );
  });

  /**
   * The type is not mutable in the MVP (T4 answers 409), so the editor does not
   * offer it as a choice and the payload restates the stored one.
   */
  it("does not let the tendero change the type of a stored coupon", async () => {
    route([coupon()]);
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("Editar")).toBeTruthy());
    fireEvent.press(screen.getByText("Editar"));

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Título del cupón")).toBeTruthy(),
    );
    expect(screen.queryByText("2x1 / Combo")).toBeNull();
    expect(screen.getByText("Tipo: % de descuento")).toBeTruthy();
  });

  it("goes back to the list on cancel without sending anything", async () => {
    const calls = route([coupon()]);
    const screen = render(<CouponsScreen />);

    await waitFor(() => expect(screen.getByText("Editar")).toBeTruthy());
    fireEvent.press(screen.getByText("Editar"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Título del cupón")).toBeTruthy(),
    );
    fireEvent.press(screen.getByText("Cancelar"));

    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Título del cupón")).toBeNull(),
    );
    expect(
      calls.some((call) => call.method === "PATCH" || call.method === "POST"),
    ).toBe(false);
  });
});
