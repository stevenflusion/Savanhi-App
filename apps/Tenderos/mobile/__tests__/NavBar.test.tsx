import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import { FloatingTabBar } from "@/src/components/NavBar";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

/**
 * Every route Expo Router hands the custom bar, orders included: the frozen
 * route still exists as a file (S12), so the bar's own visible list is what
 * keeps it off the screen.
 */
const ROUTE_NAMES = ["index", "products", "orders", "coupons", "profile"];

function renderBar(activeRouteName: string) {
  const navigate = jest.fn();
  const state = {
    index: ROUTE_NAMES.indexOf(activeRouteName),
    routes: ROUTE_NAMES.map((name) => ({ key: `${name}-key`, name })),
  };
  const screen = render(
    <FloatingTabBar state={state} navigation={{ navigate }} />,
  );
  return { screen, navigate };
}

describe("FloatingTabBar", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("renders the four tabs and the center scan button", () => {
    const { screen } = renderBar("index");

    expect(screen.getByLabelText("Inicio")).toBeTruthy();
    expect(screen.getByLabelText("Productos")).toBeTruthy();
    expect(screen.getByLabelText("Cupones")).toBeTruthy();
    expect(screen.getByLabelText("Perfil")).toBeTruthy();
    expect(screen.getByLabelText("Escanear")).toBeTruthy();
  });

  it("shows the label of every tab beside its icon", () => {
    const { screen } = renderBar("index");

    expect(screen.getByText("Inicio")).toBeTruthy();
    expect(screen.getByText("Productos")).toBeTruthy();
    expect(screen.getByText("Cupones")).toBeTruthy();
    expect(screen.getByText("Perfil")).toBeTruthy();
  });

  /** Orders are frozen for the cuponera MVP (S12). */
  it("never renders the frozen orders tab", () => {
    const { screen } = renderBar("index");

    expect(screen.queryByLabelText("Pedidos")).toBeNull();
    expect(screen.queryByText("Pedidos")).toBeNull();
  });

  it("marks exactly the active route as selected, following the route name", () => {
    for (const [routeName, label] of [
      ["index", "Inicio"],
      ["products", "Productos"],
      ["coupons", "Cupones"],
      ["profile", "Perfil"],
    ] as const) {
      const { screen } = renderBar(routeName);
      const selected = ["Inicio", "Productos", "Cupones", "Perfil"].filter(
        (candidate) =>
          screen.getByLabelText(candidate).props.accessibilityState?.selected ===
          true,
      );
      expect(selected).toEqual([label]);
      screen.unmount();
    }
  });

  /**
   * The focus does not follow the hidden route either: standing on `orders`
   * leaves every visible tab unselected rather than selecting a neighbour.
   */
  it("selects no tab while the hidden route is the active one", () => {
    const { screen } = renderBar("orders");

    for (const label of ["Inicio", "Productos", "Cupones", "Perfil"]) {
      expect(
        screen.getByLabelText(label).props.accessibilityState?.selected,
      ).toBe(false);
    }
  });

  it("navigates to each tab by its route name", () => {
    const { screen, navigate } = renderBar("index");

    fireEvent.press(screen.getByLabelText("Productos"));
    fireEvent.press(screen.getByLabelText("Cupones"));
    fireEvent.press(screen.getByLabelText("Perfil"));
    fireEvent.press(screen.getByLabelText("Inicio"));

    expect(navigate.mock.calls).toEqual([
      ["products"],
      ["coupons"],
      ["profile"],
      ["index"],
    ]);
  });

  /**
   * The center button is the scanner now (T9 builds the real screen behind
   * `/scanner`). It leaves the tab navigator, so it goes through the router and
   * not through `navigation.navigate`.
   */
  it("sends the center button to the /scanner route", () => {
    const { screen, navigate } = renderBar("index");

    fireEvent.press(screen.getByLabelText("Escanear"));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/scanner");
    expect(navigate).not.toHaveBeenCalled();
  });

  /**
   * The bar carries exactly five controls now. The old center button opened
   * Productos with an add intent; that action did not move into a sixth
   * control, it stayed on the Productos tab itself (see
   * `products-add-action.test.tsx`).
   */
  it("carries no control besides the four tabs and the scan button", () => {
    const { screen } = renderBar("index");

    expect(screen.queryByLabelText("Agregar producto")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders no identifier anywhere (S11)", () => {
    const { screen } = renderBar("coupons");

    expect(JSON.stringify(screen.toJSON())).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
});
