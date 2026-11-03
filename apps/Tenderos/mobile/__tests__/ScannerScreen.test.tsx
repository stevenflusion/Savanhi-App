process.env.TZ = "America/Bogota";

import type { Coupon, CouponRedemption } from "@repo/api-contracts";
import React from "react";
import { Linking } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { ScannerScreen } from "@/src/features/coupons/presentation/screens/ScannerScreen";

const QR_TOKEN = "Zm9vYmFyLXRva2VuLW5vdC1yZW5kZXJlZC1hbnl3aGVyZQ";
const OTHER_TOKEN = "b3RoZXItdG9rZW4tdGhhdC1pcy1hbHNvLXNlY3JldA";
const PREVIEW_PATH = "/api/v1/tenderos/coupon-redemptions/preview";
const REDEEM_PATH = "/api/v1/tenderos/coupon-redemptions";
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CLOCK_PATTERN = /\d{1,2}:\d{2}/;

const mockRequestAuthenticated = jest.fn();
jest.mock("@/src/features/auth", () => ({
  useAuth: () => ({ requestAuthenticated: mockRequestAuthenticated }),
}));

const mockRequestPermission = jest.fn();
const mockPermission: { value: unknown } = { value: null };
const mockCamera: { props: Record<string, any> | null } = { props: null };

/**
 * `expo-camera` is mocked here because a camera preview cannot run under Jest.
 * The mock keeps the real contract the screen depends on: the permission hook's
 * tuple, and a view that hands its `onBarcodeScanned` callback to the test so a
 * scan can be fired exactly as the native module would fire it.
 */
jest.mock("expo-camera", () => {
  const ReactLib = require("react");
  const { View } = require("react-native");
  return {
    CameraView: (props: Record<string, any>) => {
      mockCamera.props = props;
      return ReactLib.createElement(
        View,
        { testID: "camera-view" },
        props.children,
      );
    },
    useCameraPermissions: () => [mockPermission.value, mockRequestPermission],
  };
});

const COUPON: Coupon = {
  id: "22222222-2222-4222-8222-222222222222",
  storeId: "11111111-1111-4111-8111-111111111111",
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
      productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Leche entera 1 L",
      category: { id: "cat-1", name: "Lácteos", key: "lacteos" },
    },
    {
      source: "store_private",
      productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Empanadas de la casa",
      category: null,
    },
  ],
};

const preview = (overrides: Partial<CouponRedemption> = {}): CouponRedemption => ({
  claimId: "33333333-3333-4333-8333-333333333333",
  status: "claimed",
  redeemedOn: null,
  customerName: "Rosa",
  coupon: COUPON,
  store: { id: COUPON.storeId, name: "Tienda Doña Rosa" },
  ...overrides,
});

const redeemed = (overrides: Partial<CouponRedemption> = {}): CouponRedemption =>
  preview({ status: "redeemed", redeemedOn: "2026-11-03", ...overrides });

const ok = (data: unknown) => ({
  success: true,
  response: { json: async () => ({ data }) },
});

type Routes = Record<string, unknown>;

/**
 * Routes the screen's real repository over a recorded fake of the
 * authenticated transport, so the screen and its repository are exercised
 * together without a network or a session.
 */
function route(overrides: Routes = {}) {
  const table: Routes = {
    [`POST ${PREVIEW_PATH}`]: ok(preview()),
    [`POST ${REDEEM_PATH}`]: ok(redeemed()),
    ...overrides,
  };
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

const sentTo = (
  calls: { path: string; method: string; body: unknown }[],
  path: string,
) => calls.filter((call) => call.method === "POST" && call.path === path);

const granted = { granted: true, canAskAgain: true, status: "granted" };
const undetermined = {
  granted: false,
  canAskAgain: true,
  status: "undetermined",
};
const denied = { granted: false, canAskAgain: false, status: "denied" };

async function scan(token = QR_TOKEN) {
  await act(async () => {
    mockCamera.props?.onBarcodeScanned?.({ type: "qr", data: token });
  });
}

beforeEach(() => {
  mockRequestAuthenticated.mockReset();
  mockRequestPermission.mockReset();
  mockCamera.props = null;
  mockPermission.value = granted;
  route();
});

describe("ScannerScreen permission states", () => {
  it("waits while the permission is still unknown, with no camera mounted", () => {
    mockPermission.value = null;

    const screen = render(<ScannerScreen />);

    expect(screen.getByText("Preparando la cámara...")).toBeTruthy();
    expect(screen.queryByTestId("camera-view")).toBeNull();
  });

  it("asks for the permission while it can still be asked for", () => {
    mockPermission.value = undetermined;

    const screen = render(<ScannerScreen />);
    expect(screen.queryByTestId("camera-view")).toBeNull();
    fireEvent.press(screen.getByText("Permitir cámara"));

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it("sends a denied tendero to the system settings", () => {
    const openSettings = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue(undefined);
    mockPermission.value = denied;

    const screen = render(<ScannerScreen />);
    expect(screen.queryByText("Permitir cámara")).toBeNull();
    fireEvent.press(screen.getByText("Abrir ajustes"));

    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it("mounts the camera once the permission is granted", () => {
    const screen = render(<ScannerScreen />);

    expect(screen.getByTestId("camera-view")).toBeTruthy();
    expect(screen.getByText("Apunta al código QR del cliente")).toBeTruthy();
  });

  it("toggles the torch on the camera itself", () => {
    const screen = render(<ScannerScreen />);
    expect(mockCamera.props?.enableTorch).toBe(false);

    fireEvent.press(screen.getByLabelText("Linterna"));
    expect(mockCamera.props?.enableTorch).toBe(true);

    fireEvent.press(screen.getByLabelText("Linterna"));
    expect(mockCamera.props?.enableTorch).toBe(false);
  });

  it("reads QR codes and nothing else", () => {
    render(<ScannerScreen />);

    expect(mockCamera.props?.barcodeScannerSettings).toEqual({
      barcodeTypes: ["qr"],
    });
  });
});

describe("ScannerScreen scanning", () => {
  it("fires exactly one preview however many times the camera reports the code", async () => {
    const calls = route();
    render(<ScannerScreen />);

    await act(async () => {
      mockCamera.props?.onBarcodeScanned?.({ type: "qr", data: QR_TOKEN });
      mockCamera.props?.onBarcodeScanned?.({ type: "qr", data: QR_TOKEN });
      mockCamera.props?.onBarcodeScanned?.({ type: "qr", data: QR_TOKEN });
    });

    await waitFor(() => expect(sentTo(calls, PREVIEW_PATH)).toHaveLength(1));
    expect(sentTo(calls, PREVIEW_PATH)[0]?.body).toEqual({
      qrToken: QR_TOKEN,
    });
  });

  it("keeps the lock while the preview is on screen", async () => {
    const calls = route();
    const screen = render(<ScannerScreen />);

    await scan();
    await waitFor(() => expect(screen.getByText("Canjear")).toBeTruthy());
    await scan(OTHER_TOKEN);

    expect(sentTo(calls, PREVIEW_PATH)).toHaveLength(1);
  });

  it("shows the coupon, its value and its products, with no token, id or time", async () => {
    const screen = render(<ScannerScreen />);

    await scan();

    await waitFor(() => expect(screen.getByText("15% en lácteos")).toBeTruthy());
    expect(screen.getByText("% de descuento")).toBeTruthy();
    expect(screen.getByText("15% de descuento")).toBeTruthy();
    expect(screen.getByText("Leche entera 1 L")).toBeTruthy();
    expect(screen.getByText("Empanadas de la casa")).toBeTruthy();
    expect(screen.getAllByTestId("redemption-product-icon")).toHaveLength(2);
    expect(screen.getByText("Rosa")).toBeTruthy();

    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered).not.toContain(QR_TOKEN);
    expect(rendered).not.toMatch(UUID_PATTERN);
    expect(rendered).not.toMatch(CLOCK_PATTERN);
  });

  it("names the customer in Spanish when the profile carries no name", async () => {
    route({ [`POST ${PREVIEW_PATH}`]: ok(preview({ customerName: null })) });
    const screen = render(<ScannerScreen />);

    await scan();

    await waitFor(() =>
      expect(screen.getByText("Cliente sin nombre")).toBeTruthy(),
    );
  });

  it("redeems exactly once however many times the button is pressed", async () => {
    const calls = route();
    const screen = render(<ScannerScreen />);

    await scan();
    await waitFor(() => expect(screen.getByText("Canjear")).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText("Canjear"));
      fireEvent.press(screen.getByText("Canjear"));
    });

    await waitFor(() => expect(sentTo(calls, REDEEM_PATH)).toHaveLength(1));
    expect(sentTo(calls, REDEEM_PATH)[0]?.body).toEqual({ qrToken: QR_TOKEN });
  });

  it("confirms the redemption with the date only (S11)", async () => {
    const screen = render(<ScannerScreen />);

    await scan();
    await waitFor(() => expect(screen.getByText("Canjear")).toBeTruthy());
    fireEvent.press(screen.getByText("Canjear"));

    await waitFor(() => expect(screen.getByText("¡Cupón canjeado!")).toBeTruthy());
    expect(screen.getByText("Canjeado el 3 nov 2026")).toBeTruthy();

    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered).not.toMatch(CLOCK_PATTERN);
    expect(rendered).not.toMatch(UUID_PATTERN);
    expect(rendered).not.toContain(QR_TOKEN);
  });

  it("goes back to scanning from the confirmation", async () => {
    const calls = route();
    const screen = render(<ScannerScreen />);

    await scan();
    await waitFor(() => expect(screen.getByText("Canjear")).toBeTruthy());
    fireEvent.press(screen.getByText("Canjear"));
    await waitFor(() => expect(screen.getByText("Escanear otro")).toBeTruthy());
    fireEvent.press(screen.getByText("Escanear otro"));

    await waitFor(() =>
      expect(screen.getByText("Apunta al código QR del cliente")).toBeTruthy(),
    );
    await scan(OTHER_TOKEN);
    await waitFor(() => expect(sentTo(calls, PREVIEW_PATH)).toHaveLength(2));
    expect(sentTo(calls, PREVIEW_PATH)[1]?.body).toEqual({
      qrToken: OTHER_TOKEN,
    });
  });
});

describe("ScannerScreen error states", () => {
  it.each([
    ["No claim matches this QR code.", "Este código no es de un cupón de tu tienda."],
    ["This coupon has already been redeemed.", "Este cupón ya fue canjeado."],
    ["This coupon is no longer valid.", "Este cupón ya venció."],
    [
      "No se pudo conectar con el servidor.",
      "No se pudo conectar con el servidor.",
    ],
  ])("shows the Spanish message for %s and offers a new scan", async (
    apiError,
    spanish,
  ) => {
    const calls = route({
      [`POST ${PREVIEW_PATH}`]: { success: false, error: apiError },
    });
    const screen = render(<ScannerScreen />);

    await scan();

    await waitFor(() => expect(screen.getByText(spanish)).toBeTruthy());
    expect(screen.queryByText("Canjear")).toBeNull();

    fireEvent.press(screen.getByText("Escanear de nuevo"));
    await waitFor(() =>
      expect(screen.getByText("Apunta al código QR del cliente")).toBeTruthy(),
    );
    await scan(OTHER_TOKEN);
    await waitFor(() => expect(sentTo(calls, PREVIEW_PATH)).toHaveLength(2));
  });

  /**
   * A redeem request that was SENT and then failed may have committed, so the
   * app never repeats it on its own: the tendero scans again, and a re-scan is
   * what answers "already redeemed" when it did commit.
   */
  it("never retries a redemption that failed after being sent", async () => {
    const calls = route({
      [`POST ${REDEEM_PATH}`]: {
        success: false,
        error: "No se pudo conectar con el servidor.",
      },
    });
    const screen = render(<ScannerScreen />);

    await scan();
    await waitFor(() => expect(screen.getByText("Canjear")).toBeTruthy());
    fireEvent.press(screen.getByText("Canjear"));

    await waitFor(() =>
      expect(screen.getByText("No se pudo conectar con el servidor.")).toBeTruthy(),
    );
    expect(sentTo(calls, REDEEM_PATH)).toHaveLength(1);
    expect(screen.queryByText("Canjear")).toBeNull();
    expect(
      screen.getByText("Escanea el código otra vez para ver su estado."),
    ).toBeTruthy();
    expect(screen.getByText("Escanear de nuevo")).toBeTruthy();

    await act(async () => {
      await Promise.resolve();
    });
    expect(sentTo(calls, REDEEM_PATH)).toHaveLength(1);
  });

  it("never renders the scanned token in any state", async () => {
    route({
      [`POST ${PREVIEW_PATH}`]: {
        success: false,
        error: "No claim matches this QR code.",
      },
    });
    const screen = render(<ScannerScreen />);

    await scan();

    await waitFor(() =>
      expect(
        screen.getByText("Este código no es de un cupón de tu tienda."),
      ).toBeTruthy(),
    );
    expect(JSON.stringify(screen.toJSON())).not.toContain(QR_TOKEN);
  });
});
