import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ProductsWorkspace } from "@/src/components/ProductsWorkspace";

const mockRequestAuthenticated = jest.fn();
jest.mock("@/src/features/auth", () => ({
  useAuth: () => ({ requestAuthenticated: mockRequestAuthenticated }),
}));
jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback]),
}));

const response = (data: unknown) => ({
  success: true,
  response: { json: async () => ({ data }) },
});

describe("ProductsWorkspace", () => {
  beforeEach(() => mockRequestAuthenticated.mockReset());

  it("loads the selected store's shared and private stock from persisted routes", async () => {
    mockRequestAuthenticated.mockImplementation(async (path: string) => {
      if (path === "/api/v1/tenderos/stores/me")
        return response([{ id: "s1", name: "Market" }, { id: "s2" }]);
      if (path === "/api/v1/tenderos/catalog") return response([]);
      if (path.endsWith("/s1/catalog"))
        return response([
          {
            id: "assignment",
            product: {
              commercialName: "Rice",
              categoryName: "Food",
              brandName: "",
              presentation: "",
              netContent: null,
              netContentUnit: null,
              observedPrices: [],
            },
            price: null,
            stock: 1,
            active: false,
            saleUnit: "kg",
            integerOnly: false,
          },
        ]);
      if (path.endsWith("/s1/products"))
        return response([
          {
            id: "private",
            name: "Local beans",
            categoryName: null,
            price: 2.5,
            stock: 1,
            active: true,
            saleUnit: "kg",
            integerOnly: false,
          },
        ]);
      if (path.endsWith("/s1/product-categories"))
        return response([{ id: "c1", name: "Pantry", shared: true }]);
      return response([]);
    });

    const screen = render(<ProductsWorkspace />);
    await waitFor(() =>
      expect(mockRequestAuthenticated).toHaveBeenCalledWith(
        "/api/v1/tenderos/stores/s1/products",
        undefined,
      ),
    );
    expect(mockRequestAuthenticated).toHaveBeenCalledWith(
      "/api/v1/tenderos/stores/s1/product-categories",
      undefined,
    );
    expect(screen.getByText("Local beans")).toBeTruthy();
    expect(screen.getByText("Price pending")).toBeTruthy();
    expect(screen.getByText("Shared catalog")).toBeTruthy();
    expect(screen.getByText("Store private")).toBeTruthy();
  });

  it("requires valid positive price and sale unit before adding a shared product", async () => {
    mockRequestAuthenticated.mockImplementation(async (path: string) => {
      if (path === "/api/v1/tenderos/stores/me")
        return response([{ id: "s1" }]);
      if (path === "/api/v1/tenderos/catalog")
        return response([
          {
            id: "p1",
            commercialName: "Water",
            categoryName: "Drinks",
            brandName: "",
            presentation: "500 ml",
            netContent: 500,
            netContentUnit: "ml",
            observedPrices: [],
          },
        ]);
      if (path.endsWith("/catalog")) return response([]);
      return response([]);
    });
    const screen = render(<ProductsWorkspace addIntent />);
    await waitFor(() => expect(screen.getByText("Water")).toBeTruthy());
    fireEvent.press(screen.getByText("Water"));
    fireEvent.press(screen.getByText("Agregar a mi tienda"));
    expect(mockRequestAuthenticated).not.toHaveBeenCalledWith(
      expect.stringContaining("/stores/s1/catalog"),
      expect.objectContaining({ method: "POST" }),
    );
    fireEvent.changeText(screen.getByPlaceholderText("Price (USD)"), "1.25");
    fireEvent.press(screen.getByText("kg"));
    fireEvent.press(screen.getByText("Agregar a mi tienda"));
    await waitFor(() =>
      expect(mockRequestAuthenticated).toHaveBeenCalledWith(
        "/api/v1/tenderos/stores/s1/catalog",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            productId: "p1",
            price: 1.25,
            saleUnit: "kg",
            integerOnly: false,
          }),
        }),
      ),
    );
  });

  it("creates a private product and store-private category using store-scoped endpoints", async () => {
    mockRequestAuthenticated.mockImplementation(async (path: string) => {
      if (path === "/api/v1/tenderos/stores/me")
        return response([{ id: "s1" }]);
      if (path.endsWith("/catalog")) return response([]);
      if (path.endsWith("/products")) return response([]);
      if (path.endsWith("/product-categories")) return response([]);
      return response([]);
    });
    const screen = render(<ProductsWorkspace addIntent />);
    await waitFor(() =>
      expect(screen.getByText("Add private product")).toBeTruthy(),
    );
    fireEvent.press(screen.getByText("Add private product"));
    fireEvent.changeText(
      screen.getByPlaceholderText("Product name"),
      "Farm eggs",
    );
    fireEvent.changeText(screen.getByPlaceholderText("Price (USD)"), "3.50");
    fireEvent.press(screen.getByText("Create category"));
    fireEvent.changeText(screen.getByPlaceholderText("Category name"), "Farm");
    fireEvent.press(screen.getByText("Save category"));
    await waitFor(() =>
      expect(mockRequestAuthenticated).toHaveBeenCalledWith(
        "/api/v1/tenderos/stores/s1/product-categories",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Farm" }),
        }),
      ),
    );
  });

  /**
   * S11 on the biggest screen in the app: the tendero never reads a UUID and
   * never reads a clock time. Both are reachable here — every product row is
   * keyed by a real id and the catalog's observed prices carry an
   * `observedAt` ISO TIMESTAMP that the workspace sorts by — so the fixture
   * carries both and the assertion walks every rendered string.
   *
   * It is a PIN rather than a RED: the screen already renders neither, and
   * this is what makes adding the date to a price line fail here instead of
   * shipping.
   */
  it("renders no identifier and no clock time (S11)", async () => {
    const STORE_ID = "11111111-1111-4111-8111-111111111111";
    const ASSIGNMENT_ID = "22222222-2222-4222-8222-222222222222";
    const PRIVATE_ID = "33333333-3333-4333-8333-333333333333";
    const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";

    mockRequestAuthenticated.mockImplementation(async (path: string) => {
      if (path === "/api/v1/tenderos/stores/me")
        return response([{ id: STORE_ID, name: "Tienda Doña Rosa" }]);
      if (path === "/api/v1/tenderos/catalog") return response([]);
      if (path.endsWith("/catalog"))
        return response([
          {
            id: ASSIGNMENT_ID,
            product: {
              commercialName: "Arroz 1 kg",
              categoryName: "Despensa",
              brandName: "",
              presentation: "",
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
            price: 1.5,
            stock: 4,
            active: true,
            saleUnit: "kg",
            integerOnly: false,
          },
        ]);
      if (path.endsWith("/products"))
        return response([
          {
            id: PRIVATE_ID,
            name: "Empanadas de la casa",
            categoryName: null,
            price: 0.8,
            stock: 10,
            active: true,
            saleUnit: "unidad",
            integerOnly: true,
          },
        ]);
      if (path.endsWith("/product-categories"))
        return response([
          { id: CATEGORY_ID, name: "Despensa", shared: true },
        ]);
      return response([]);
    });

    const screen = render(<ProductsWorkspace />);
    await waitFor(() => expect(screen.getByText("Arroz 1 kg")).toBeTruthy());

    const uuid =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const clock = /\d{1,2}:\d{2}/;
    const { Text } = require("react-native");

    for (const node of screen.UNSAFE_getAllByType(Text)) {
      const children = node.props.children;
      for (const child of Array.isArray(children) ? children : [children]) {
        if (typeof child !== "string") continue;
        expect(child).not.toMatch(uuid);
        expect(child).not.toMatch(clock);
      }
    }
  });
});
