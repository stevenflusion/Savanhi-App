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
});
