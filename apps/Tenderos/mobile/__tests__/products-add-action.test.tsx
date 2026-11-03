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

/**
 * PRESERVE for T8. The floating bar's center button used to open the Productos
 * tab with `intent: "add"`; it is the scanner now. This pins that the action
 * itself was not lost: the Productos tab still opens the add tool on its own,
 * and the `intent=add` entry point it was reached by still works.
 */
describe("the action the old center [+] button performed", () => {
  beforeEach(() => {
    mockRequestAuthenticated.mockReset();
    mockRequestAuthenticated.mockImplementation(async (path: string) => {
      if (path === "/api/v1/tenderos/stores/me")
        return response([{ id: "s1", name: "Market" }]);
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
      return response([]);
    });
  });

  it("is reachable by tapping Agregar producto inside the Productos tab", async () => {
    const screen = render(<ProductsWorkspace />);

    await waitFor(() =>
      expect(screen.getByText("Agregar producto")).toBeTruthy(),
    );
    // The add tool is closed until the tendero asks for it.
    expect(screen.queryByText("Elegir del catálogo global")).toBeNull();

    fireEvent.press(screen.getByText("Agregar producto"));

    expect(screen.getByText("Elegir del catálogo global")).toBeTruthy();
    expect(screen.getByPlaceholderText("Price (USD)")).toBeTruthy();
  });

  it("still honours the intent=add entry point the button used", async () => {
    const screen = render(<ProductsWorkspace addIntent />);

    await waitFor(() =>
      expect(screen.getByText("Elegir del catálogo global")).toBeTruthy(),
    );
  });
});
