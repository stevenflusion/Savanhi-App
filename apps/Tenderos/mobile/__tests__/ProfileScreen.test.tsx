import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

const mockRequestAuthenticated = jest.fn();
const mockLogout = jest.fn();
jest.mock("@/src/features/auth", () => ({
  useAuth: () => ({
    user: { fullName: "Rosa Pérez", email: "rosa@example.com" },
    logout: mockLogout,
    isReady: true,
    requestAuthenticated: mockRequestAuthenticated,
  }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback]),
}));

/**
 * The location derivation is MOCKED at the shared module, which is the whole
 * point of this unit: `profile.tsx` used to carry its own inline copy of the
 * Mapbox-then-device-then-address chain, so the app had two geocoding paths
 * that could word the same coordinates differently. If the screen ever grows
 * a second copy, the label stops coming from here and this suite fails.
 */
const mockResolveStoreLocationLabel = jest.fn();
jest.mock("@/src/lib/store-location", () => ({
  resolveStoreLocationLabel: (store: unknown) =>
    mockResolveStoreLocationLabel(store),
}));

import { ProfileScreen } from "@/src/features/profile/presentation/screens/ProfileScreen";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const PRIVATE_ID = "22222222-2222-4222-8222-222222222222";
const ASSIGNMENT_ID = "33333333-3333-4333-8333-333333333333";

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CLOCK_PATTERN = /\d{1,2}:\d{2}/;

const STORE_PHOTO_URL = "https://garage.local/stores/front.jpg";

const STORE = {
  id: STORE_ID,
  name: "Tienda Doña Rosa",
  address: "Av. Amazonas 123, Quito, Ecuador",
  latitude: -0.18,
  longitude: -78.47,
  photos: [{ url: STORE_PHOTO_URL, position: 0 }],
};

const ok = (data: unknown) => ({
  success: true,
  response: { json: async () => ({ data }) },
});

type Routes = Record<string, unknown>;

function route(overrides: Routes = {}) {
  const table: Routes = {
    "GET /api/v1/tenderos/stores/me": ok([STORE]),
    [`GET /api/v1/tenderos/stores/${STORE_ID}/products`]: ok([
      {
        id: PRIVATE_ID,
        name: "Empanada de viento",
        categoryId: null,
        categoryName: null,
        price: 0.8,
        stock: 10,
        active: true,
        saleUnit: "unidad",
        integerOnly: true,
      },
    ]),
    [`GET /api/v1/tenderos/stores/${STORE_ID}/catalog`]: ok([
      {
        id: ASSIGNMENT_ID,
        price: 1.5,
        stock: 0,
        active: true,
        saleUnit: "kg",
        integerOnly: false,
        product: {
          id: "catalog-row",
          categoryId: "cat-1",
          categoryName: "Despensa",
          commercialName: "Arroz 1 kg",
          brandName: "Marca",
          presentation: null,
          netContent: null,
          netContentUnit: null,
          observedPrices: [
            {
              amount: 1.25,
              currency: "USD",
              source: "supermaxi",
              observedAt: "2026-11-03T14:35:00.000Z",
            },
          ],
        },
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
  mockLogout.mockReset();
  mockResolveStoreLocationLabel.mockReset();
  mockResolveStoreLocationLabel.mockResolvedValue("Quito, La Floresta");
});

describe("the Perfil tab header", () => {
  it("shows the store photo, the store name, the owner and the location", async () => {
    route();
    const screen = render(<ProfileScreen />);

    await waitFor(() =>
      expect(screen.getByText("Tienda Doña Rosa")).toBeTruthy(),
    );

    expect(screen.getByTestId("store-photo").props.source).toEqual({
      uri: STORE_PHOTO_URL,
    });
    expect(screen.getByText("Rosa Pérez")).toBeTruthy();
    expect(screen.getByText("Quito, La Floresta")).toBeTruthy();
  });

  it("falls back to the store initial when there is no photo", async () => {
    route({ "GET /api/v1/tenderos/stores/me": ok([{ ...STORE, photos: [] }]) });
    const screen = render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByTestId("store-initial")).toBeTruthy());
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.queryByTestId("store-photo")).toBeNull();
  });

  it("words an empty location instead of leaving a blank line", async () => {
    mockResolveStoreLocationLabel.mockResolvedValue("");
    route();
    const screen = render(<ProfileScreen />);

    await waitFor(() =>
      expect(
        screen.getByText("Agrega la ubicación de tu tienda"),
      ).toBeTruthy(),
    );
  });
});

describe("the one location path", () => {
  it("derives the label through the shared store-location module", async () => {
    route();
    const screen = render(<ProfileScreen />);

    await waitFor(() =>
      expect(mockResolveStoreLocationLabel).toHaveBeenCalledWith(
        expect.objectContaining({
          address: STORE.address,
          latitude: STORE.latitude,
          longitude: STORE.longitude,
        }),
      ),
    );
    expect(screen.getByText("Quito, La Floresta")).toBeTruthy();
  });

  it("never reaches a geocoder on its own", async () => {
    route();
    render(<ProfileScreen />);

    await waitFor(() =>
      expect(mockResolveStoreLocationLabel).toHaveBeenCalled(),
    );
    // Not one request goes anywhere near Mapbox from this screen.
    for (const { path } of mockRequestAuthenticated.mock.calls.map(
      ([path]: [string]) => ({ path }),
    )) {
      expect(path).not.toMatch(/mapbox/i);
    }
  });
});

describe("the Perfil tab data", () => {
  it("counts the active products of the store and lists them", async () => {
    route();
    const screen = render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByText("Arroz 1 kg")).toBeTruthy());

    expect(screen.getByText("Empanada de viento")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("Productos")).toBeTruthy();
    expect(screen.getByText("$0.80")).toBeTruthy();
    expect(screen.getByText("Agotado")).toBeTruthy();
  });

  it("shows the account the tendero signed in with", async () => {
    route();
    const screen = render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByText("Rosa Pérez")).toBeTruthy());
    expect(screen.getByText("rosa@example.com")).toBeTruthy();
  });

  /**
   * There are no ratings anywhere in this product: no table, no endpoint, no
   * field. The line stays as the neutral fact it is and the five empty stars
   * are gone — a star row is a rating widget, and drawing one for data that
   * does not exist promises a feature the app does not have.
   */
  it("keeps the ratings line neutral and draws no stars", async () => {
    route();
    const screen = render(<ProfileScreen />);

    await waitFor(() =>
      expect(screen.getByText("Sin calificaciones")).toBeTruthy(),
    );
    expect(screen.queryByTestId("rating-stars")).toBeNull();
  });

  it("words an empty catalog instead of showing an empty block", async () => {
    route({
      [`GET /api/v1/tenderos/stores/${STORE_ID}/products`]: ok([]),
      [`GET /api/v1/tenderos/stores/${STORE_ID}/catalog`]: ok([]),
    });
    const screen = render(<ProfileScreen />);

    await waitFor(() =>
      expect(
        screen.getByText("Tus productos aparecerán aquí cuando los agregues."),
      ).toBeTruthy(),
    );
  });

  it("stands on its own when the tendero has no store yet", async () => {
    route({ "GET /api/v1/tenderos/stores/me": ok([]) });
    const screen = render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByText("Rosa Pérez")).toBeTruthy());
    expect(screen.getByText("Cerrar sesión")).toBeTruthy();
  });
});

describe("the Perfil tab actions", () => {
  it("still logs the tendero out", async () => {
    route();
    const screen = render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByText("Cerrar sesión")).toBeTruthy());

    fireEvent.press(screen.getByText("Cerrar sesión"));
    expect(mockLogout).toHaveBeenCalled();
  });
});

describe("the Perfil tab (S11)", () => {
  it("renders no identifier and no clock time", async () => {
    route();
    const screen = render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByText("Arroz 1 kg")).toBeTruthy());

    for (const text of renderedText(screen)) {
      expect(text).not.toMatch(UUID_PATTERN);
      expect(text).not.toMatch(CLOCK_PATTERN);
    }
  });
});
