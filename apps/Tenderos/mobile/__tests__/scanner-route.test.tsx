import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import ScannerRoute from "@/app/scanner";

const mockRequestAuthenticated = jest.fn();
jest.mock("@/src/features/auth", () => ({
  useAuth: () => ({ requestAuthenticated: mockRequestAuthenticated }),
}));

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

const mockRequestPermission = jest.fn();
jest.mock("expo-camera", () => {
  const ReactLib = require("react");
  const { View } = require("react-native");
  return {
    CameraView: (props: Record<string, any>) =>
      ReactLib.createElement(View, { testID: "camera-view" }, props.children),
    useCameraPermissions: () => [
      { granted: true, canAskAgain: true, status: "granted" },
      mockRequestPermission,
    ],
  };
});

/**
 * The route itself: the floating bar's centre button pushes `/scanner`, so the
 * file behind it has to render the real scanner and nothing else. T8 left a
 * stub here; this pins that the stub is gone.
 */
describe("the /scanner route", () => {
  beforeEach(() => {
    mockBack.mockReset();
  });

  it("renders the scanner with its header", () => {
    const screen = render(<ScannerRoute />);

    expect(screen.getByText("Escanear")).toBeTruthy();
    expect(screen.getByTestId("camera-view")).toBeTruthy();
    expect(screen.queryByText("El escáner llega pronto")).toBeNull();
  });

  it("goes back from the header button", () => {
    const screen = render(<ScannerRoute />);

    fireEvent.press(screen.getByLabelText("Volver"));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
