import React from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react-native";

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

import { ProductDetailScreen } from "@/src/features/products/presentation/screens/ProductDetailScreen";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const RICE = "22222222-2222-4222-8222-222222222222";
const MILK = "33333333-3333-4333-8333-333333333333";
const EMPANADA = "44444444-4444-4444-8444-444444444444";
const CATEGORY_ID = "55555555-5555-4555-8555-555555555555";

const CATALOG_PATH = `/api/v1/tenderos/stores/${STORE_ID}/catalog`;
const PRIVATE_PATH = `/api/v1/tenderos/stores/${STORE_ID}/products`;

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CLOCK_PATTERN = /\d{1,2}:\d{2}/;

const catalogRow = (
  id: string,
  commercialName: string,
  categoryName: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  price: 1.5,
  stock: 4,
  active: true,
  saleUnit: "kg",
  integerOnly: false,
  product: {
    id: `${id}-catalog`,
    categoryId: CATEGORY_ID,
    categoryName,
    commercialName,
    brandName: "Marca",
    presentation: null,
    netContent: null,
    netContentUnit: null,
    observedPrices: [],
  },
  ...overrides,
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
    [`GET ${CATALOG_PATH}`]: ok([
      catalogRow(RICE, "Arroz 1 kg", "Despensa"),
      catalogRow(MILK, "Leche entera 1 L", "Lácteos", {
        price: 0.95,
        stock: 12,
      }),
    ]),
    [`GET ${PRIVATE_PATH}`]: ok([
      {
        id: EMPANADA,
        name: "Empanada de viento",
        categoryId: null,
        categoryName: null,
        price: 0.8,
        stock: 0,
        active: true,
        saleUnit: "unidad",
        integerOnly: true,
      },
    ]),
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
  const carousel = screen.getByTestId("product-detail-carousel");
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

describe("the product detail header", () => {
  it("goes back from a circular button and names the screen in the middle", async () => {
    route();
    const screen = render(<ProductDetailScreen productId={RICE} />);

    await waitFor(() => expect(screen.getByText("Producto")).toBeTruthy());

    fireEvent.press(screen.getByLabelText("Volver"));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe("the product detail carousel", () => {
  it("opens on the product the tendero tapped and not on the first one", async () => {
    route();
    const screen = render(<ProductDetailScreen productId={MILK} />);

    await waitFor(() =>
      expect(screen.getByTestId("product-detail-body")).toBeTruthy(),
    );

    const body = within(screen.getByTestId("product-detail-body"));
    expect(body.getByText("Leche entera 1 L")).toBeTruthy();
    expect(body.queryByText("Arroz 1 kg")).toBeNull();

    // The opening position is the contentOffset PROP, so the tapped product
    // is on screen from the first frame instead of after one frame of the
    // first card.
    const carousel = screen.getByTestId("product-detail-carousel");
    const interval = carousel.props.snapToInterval as number;
    expect(carousel.props.contentOffset).toEqual({ x: interval * 1, y: 0 });
  });

  it("carries every product of the store so the tendero can swipe through them", async () => {
    route();
    const screen = render(<ProductDetailScreen productId={RICE} />);

    await waitFor(() =>
      expect(screen.getByTestId(`product-detail-page-${RICE}`)).toBeTruthy(),
    );

    expect(screen.getByTestId(`product-detail-page-${MILK}`)).toBeTruthy();
    expect(screen.getByTestId(`product-detail-page-${EMPANADA}`)).toBeTruthy();
  });

  it("moves the dots and the details onto the product that was swiped to", async () => {
    route();
    const screen = render(<ProductDetailScreen productId={RICE} />);

    await waitFor(() =>
      expect(screen.getByTestId("product-detail-body")).toBeTruthy(),
    );
    expect(screen.getByTestId("page-dot-0").props.accessibilityState).toEqual({
      selected: true,
    });

    swipeTo(screen, 2);

    const body = within(screen.getByTestId("product-detail-body"));
    expect(body.getByText("Empanada de viento")).toBeTruthy();
    expect(body.queryByText("Arroz 1 kg")).toBeNull();
    expect(screen.getByTestId("page-dot-2").props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId("page-dot-0").props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it("draws the pastel category tile and the neutral default when there is no category", async () => {
    const {
      CATEGORY_COLOR_BY_KEY,
      DEFAULT_CATEGORY_COLOR,
    } = require("@/src/features/coupons/domain/category-colors");

    route();
    const screen = render(<ProductDetailScreen productId={MILK} />);

    await waitFor(() =>
      expect(screen.getByTestId(`product-detail-page-${MILK}`)).toBeTruthy(),
    );

    expect(
      screen.getByTestId(`product-detail-page-${MILK}`).props.style,
    ).toMatchObject({
      backgroundColor: CATEGORY_COLOR_BY_KEY.lacteos.surface,
    });
    expect(
      screen.getByTestId(`product-detail-page-${EMPANADA}`).props.style,
    ).toMatchObject({ backgroundColor: DEFAULT_CATEGORY_COLOR.surface });
  });
});

describe("the product detail body", () => {
  it("shows the name, the category, the price and the stock of the centred product", async () => {
    route();
    const screen = render(<ProductDetailScreen productId={RICE} />);

    await waitFor(() =>
      expect(screen.getByTestId("product-detail-body")).toBeTruthy(),
    );

    const body = within(screen.getByTestId("product-detail-body"));
    expect(body.getByText("Arroz 1 kg")).toBeTruthy();
    expect(body.getByText("Despensa")).toBeTruthy();
    expect(body.getByText("$1.50")).toBeTruthy();
    expect(body.getByText("4 en stock")).toBeTruthy();
  });

  it("words a product with no price and one with no stock instead of showing a zero", async () => {
    route({
      [`GET ${CATALOG_PATH}`]: ok([
        catalogRow(RICE, "Arroz 1 kg", "Despensa", { price: null, stock: 0 }),
      ]),
      [`GET ${PRIVATE_PATH}`]: ok([]),
    });
    const screen = render(<ProductDetailScreen productId={RICE} />);

    await waitFor(() =>
      expect(screen.getByTestId("product-detail-body")).toBeTruthy(),
    );

    const body = within(screen.getByTestId("product-detail-body"));
    expect(body.getByText("Sin precio")).toBeTruthy();
    expect(body.getByText("Agotado")).toBeTruthy();
  });

  /**
   * The reference shows a quantity stepper. There is NO stepper here and that
   * is a decision and not an omission: no endpoint saves a per-product
   * quantity on a detail screen — the only quantity a product has is its
   * stock, which the existing card edits through the products tab.
   */
  it("offers no quantity stepper", async () => {
    route();
    const screen = render(<ProductDetailScreen productId={RICE} />);

    await waitFor(() =>
      expect(screen.getByTestId("product-detail-body")).toBeTruthy(),
    );

    expect(screen.queryByLabelText("Sumar uno")).toBeNull();
    expect(screen.queryByLabelText("Restar uno")).toBeNull();
  });
});

describe("the product detail action", () => {
  it("reaches the existing edit flow for the product on screen", async () => {
    route();
    const screen = render(<ProductDetailScreen productId={RICE} />);

    await waitFor(() =>
      expect(screen.getByText("Editar producto")).toBeTruthy(),
    );

    swipeTo(screen, 1);
    fireEvent.press(screen.getByText("Editar producto"));

    expect(mockPush).toHaveBeenCalledWith(
      `/products?intent=edit&productId=${MILK}`,
    );
  });
});

describe("the product detail states", () => {
  it("says so when the product is not in the store any more", async () => {
    route();
    const screen = render(
      <ProductDetailScreen productId="99999999-9999-4999-8999-999999999999" />,
    );

    await waitFor(() =>
      expect(screen.getByText("No encontramos este producto")).toBeTruthy(),
    );
    expect(screen.queryByText("Editar producto")).toBeNull();
  });

  it("shows the failure in Spanish when the catalog cannot be read", async () => {
    route({
      [`GET ${CATALOG_PATH}`]: {
        success: false,
        error: "No se pudo cargar el catálogo.",
      },
    });
    const screen = render(<ProductDetailScreen productId={RICE} />);

    await waitFor(() =>
      expect(screen.getByText("No se pudo cargar el catálogo.")).toBeTruthy(),
    );
  });
});

describe("the product detail (S11)", () => {
  it("renders no identifier and no clock time", async () => {
    route({
      [`GET ${CATALOG_PATH}`]: ok([
        catalogRow(RICE, "Arroz 1 kg", "Despensa", {
          product: {
            ...catalogRow(RICE, "Arroz 1 kg", "Despensa").product,
            observedPrices: [
              {
                amount: 1.25,
                currency: "USD",
                source: "supermaxi",
                observedAt: "2026-11-03T14:35:00.000Z",
              },
            ],
          },
        }),
      ]),
    });
    const screen = render(<ProductDetailScreen productId={RICE} />);

    await waitFor(() =>
      expect(screen.getByTestId("product-detail-body")).toBeTruthy(),
    );

    for (const text of renderedText(screen)) {
      expect(text).not.toMatch(UUID_PATTERN);
      expect(text).not.toMatch(CLOCK_PATTERN);
    }
  });
});
