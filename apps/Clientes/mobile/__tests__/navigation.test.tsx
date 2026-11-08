import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import { ClientNavBar } from "@/src/components/ClientNavBar";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const ROUTE_NAMES = ["index", "map", "wallet", "profile"];
const LABELS = ["Inicio", "Mapa", "Billetera", "Perfil"];

function renderBar(activeRouteName: string, routeNames = ROUTE_NAMES) {
  const navigate = jest.fn();
  const state = {
    index: routeNames.indexOf(activeRouteName),
    routes: routeNames.map((name) => ({ key: `${name}-key`, name })),
  };
  const screen = render(
    <ClientNavBar state={state} navigation={{ navigate }} />,
  );
  return { screen, navigate };
}

describe("ClientNavBar", () => {
  it("shows exactly the four approved destinations, label beside icon", () => {
    const { screen } = renderBar("index");

    for (const label of LABELS) {
      expect(screen.getByLabelText(label)).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("never renders a fifth destination or a followed-only tab", () => {
    const { screen } = renderBar("index", [
      ...ROUTE_NAMES,
      "followed",
      "scanner",
    ]);

    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.queryByLabelText("Seguidas")).toBeNull();
    expect(screen.queryByText("Seguidas")).toBeNull();
  });

  it("marks exactly the active route as selected, following the route name", () => {
    for (const [routeName, label] of [
      ["index", "Inicio"],
      ["map", "Mapa"],
      ["wallet", "Billetera"],
      ["profile", "Perfil"],
    ] as const) {
      const { screen } = renderBar(routeName);
      const selected = LABELS.filter(
        (candidate) =>
          screen.getByLabelText(candidate).props.accessibilityState
            ?.selected === true,
      );

      expect(selected).toEqual([label]);
      screen.unmount();
    }
  });

  it("navigates to each destination by its route name", () => {
    const { screen, navigate } = renderBar("index");

    fireEvent.press(screen.getByLabelText("Mapa"));
    fireEvent.press(screen.getByLabelText("Billetera"));
    fireEvent.press(screen.getByLabelText("Perfil"));
    fireEvent.press(screen.getByLabelText("Inicio"));

    expect(navigate.mock.calls).toEqual([
      ["map"],
      ["wallet"],
      ["profile"],
      ["index"],
    ]);
  });

  it("sits in the layout flow, so it never covers screen content", () => {
    const { screen } = renderBar("index");
    const flat = JSON.stringify(screen.toJSON());

    expect(flat).not.toContain('"position":"absolute"');
  });

  it("carries no business data or identifier", () => {
    const { screen } = renderBar("wallet");

    expect(JSON.stringify(screen.toJSON())).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
});
