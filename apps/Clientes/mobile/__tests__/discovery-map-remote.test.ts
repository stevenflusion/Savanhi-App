import { AppState } from "react-native";
import * as Location from "expo-location";

import {
  coordinatesKey,
  coordinatesQuery,
  isCoordinates,
  roundCoordinates,
} from "@/src/features/discovery/domain/location";
import { createDeviceLocation } from "@/src/features/discovery/infrastructure/foreground-location";
import { createDiscoveryFetchRepository } from "@/src/features/discovery/infrastructure/discovery-fetch-repository";
import { getMapboxAccessToken } from "@/src/lib/mapbox";

const BASE = "http://api.test";
const POINT = { latitude: -0.18, longitude: -78.48 };

const nearby = (o: Record<string, unknown> = {}) => ({
  id: "ff86d66b-9498-42a9-8c96-9b9f58d7d4e0",
  name: "Minimarket El Vecino",
  address: "Calle 1",
  latitude: -0.181,
  longitude: -78.481,
  distanceMeters: 350,
  distanceKm: 0.35,
  ...o,
});

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
});

let fetchMock: jest.Mock;
const repo = () => createDiscoveryFetchRepository({ getBaseUrl: () => BASE });

beforeEach(() => {
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
});

describe("coordinates", () => {
  it("accepts real positions and refuses anything else", () => {
    expect(isCoordinates(POINT)).toBe(true);
    expect(isCoordinates({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isCoordinates({ latitude: 0, longitude: -181 })).toBe(false);
    expect(isCoordinates({ latitude: NaN, longitude: 0 })).toBe(false);
    expect(isCoordinates({ latitude: 0 })).toBe(false);
    expect(isCoordinates(null)).toBe(false);
  });

  it("writes a plain decimal pair that never uses an exponent", () => {
    expect(coordinatesQuery(POINT)).toBe("?lat=-0.180000&lng=-78.480000");
    expect(
      coordinatesQuery({ latitude: 0.0000001, longitude: -0.00000004 }),
    ).toBe("?lat=0.000000&lng=-0.000000");
    expect(coordinatesQuery({ latitude: 90, longitude: 180 })).toBe(
      "?lat=90.000000&lng=180.000000",
    );
  });

  it("gives equal positions one key and no position its own key", () => {
    expect(coordinatesKey(POINT)).toBe(
      coordinatesKey({ latitude: -0.18000004, longitude: -78.48000001 }),
    );
    expect(coordinatesKey(POINT)).not.toBe(
      coordinatesKey({ latitude: -0.18, longitude: -78.4801 }),
    );
    expect(coordinatesKey(null)).toBe("none");
    expect(roundCoordinates({ latitude: -0.1800004, longitude: 1 })).toEqual({
      latitude: -0.18,
      longitude: 1,
    });
  });
});

describe("getFeed with a position", () => {
  it("adds exactly the lat/lng pair and keeps the bearer header", async () => {
    fetchMock.mockResolvedValue(respond(200, { data: [] }));

    await repo().getFeed("tok-1", POINT);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/clientes/coupons/feed?lat=-0.180000&lng=-78.480000`);
    expect([...new URL(url).searchParams.keys()]).toEqual(["lat", "lng"]);
    expect(init.headers).toEqual({ Authorization: "Bearer tok-1" });
  });

  it("never sends half a pair or an impossible one: it fails without a request", async () => {
    for (const bad of [
      { latitude: 95, longitude: 0 },
      { latitude: NaN, longitude: 0 },
      { latitude: 0 },
    ]) {
      const result = await repo().getFeed("tok-1", bad as any);
      expect(result.success).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still sends the bare feed when no position is given", async () => {
    fetchMock.mockResolvedValue(respond(200, { data: [] }));

    await repo().getFeed("tok-1");
    await repo().getFeed("tok-1", undefined);

    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe(`${BASE}/api/v1/clientes/coupons/feed`);
    }
  });
});

describe("getNearbyStores", () => {
  it("is a GET of both coordinates with the bearer token and no body", async () => {
    fetchMock.mockResolvedValue(respond(200, { data: [nearby()] }));

    const result = await repo().getNearbyStores("tok-1", POINT);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/clientes/stores/nearby?lat=-0.180000&lng=-78.480000`);
    expect(init.method ?? "GET").toBe("GET");
    expect(init.headers).toEqual({ Authorization: "Bearer tok-1" });
    expect(init.body).toBeUndefined();
    expect(result).toEqual({ success: true, data: [nearby()] });
  });

  it("refuses an impossible position without a request", async () => {
    const result = await repo().getNearbyStores("tok-1", {
      latitude: 0,
      longitude: 200,
    });

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a store without coordinates", { latitude: null }],
    ["a store with an out-of-range longitude", { longitude: 400 }],
    ["a store without a distance", { distanceMeters: null }],
    ["a store with a text distance", { distanceKm: "0.35" }],
    ["a store without a name", { name: 3 }],
  ])("treats %s as a malformed answer", async (_label, override) => {
    fetchMock.mockResolvedValue(respond(200, { data: [nearby(override)] }));

    const result = await repo().getNearbyStores("tok-1", POINT);

    expect(result).toEqual({
      success: false,
      error: "No pudimos completar la solicitud.",
      status: 200,
      unauthorized: false,
    });
  });

  it("keeps the status and the eligibility code of a refusal, never the server text", async () => {
    fetchMock.mockResolvedValue(
      respond(403, {
        error: "Complete your profile.",
        details: { eligibility: "birth_date_required" },
      }),
    );

    const result = await repo().getNearbyStores("tok-1", POINT);

    expect(result).toEqual({
      success: false,
      error: "No pudimos completar la solicitud.",
      status: 403,
      unauthorized: false,
      eligibility: "birth_date_required",
    });
  });

  it("marks a 401 as unauthorized and a network failure as offline", async () => {
    fetchMock.mockResolvedValueOnce(respond(401, {}));
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    const unauthorized = await repo().getNearbyStores("tok-1", POINT);
    const offline = await repo().getNearbyStores("tok-1", POINT);

    expect(unauthorized).toMatchObject({ success: false, unauthorized: true, status: 401 });
    expect(offline).toMatchObject({ success: false, unauthorized: false });
  });
});

describe("the device foreground location", () => {
  const permission = Location.getForegroundPermissionsAsync as jest.Mock;
  const request = Location.requestForegroundPermissionsAsync as jest.Mock;
  const position = Location.getCurrentPositionAsync as jest.Mock;

  beforeEach(() => {
    for (const fn of [permission, request, position]) fn.mockReset();
  });

  it("reads the permission without ever requesting it", async () => {
    const device = createDeviceLocation();
    permission.mockResolvedValueOnce({ status: "undetermined", canAskAgain: true });
    permission.mockResolvedValueOnce({ status: "granted", canAskAgain: true });
    permission.mockResolvedValueOnce({ status: "denied", canAskAgain: false });

    expect(await device.getPermission()).toBe("undetermined");
    expect(await device.getPermission()).toBe("granted");
    expect(await device.getPermission()).toBe("denied");
    expect(request).not.toHaveBeenCalled();
  });

  it("treats an approximate grant as granted, without asking for precise", async () => {
    const device = createDeviceLocation();
    permission.mockResolvedValue({
      status: "granted",
      canAskAgain: true,
      android: { accuracy: "coarse" },
    });

    expect(await device.getPermission()).toBe("granted");
    expect(request).not.toHaveBeenCalled();
  });

  it("requests only the foreground permission and maps the answer", async () => {
    const device = createDeviceLocation();
    request.mockResolvedValue({ status: "denied", canAskAgain: true });

    expect(await device.requestPermission()).toBe("denied");
    expect(request).toHaveBeenCalledTimes(1);
    expect(permission).not.toHaveBeenCalled();
  });

  it("takes one reading without the settings dialog and rounds it", async () => {
    const device = createDeviceLocation();
    position.mockResolvedValue({
      coords: { latitude: -0.1800004, longitude: -78.48, accuracy: 4000 },
    });

    expect(await device.getPosition()).toEqual(POINT);
    expect(position).toHaveBeenCalledTimes(1);
    expect(position).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: false,
    });
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it("rejects a reading that is not a real position", async () => {
    const device = createDeviceLocation();
    position.mockResolvedValue({ coords: { latitude: NaN, longitude: 0 } });

    await expect(device.getPosition()).rejects.toBeTruthy();
  });

  it("passes a failed reading on instead of inventing a position", async () => {
    const device = createDeviceLocation();
    position.mockRejectedValue(new Error("Location provider is unavailable"));

    await expect(device.getPosition()).rejects.toThrow("unavailable");
  });

  it("calls back only when the app becomes active, and stops after the unsubscribe", () => {
    const remove = jest.fn();
    let handler: (state: string) => void = () => {};
    const add = jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation(((type: string, cb: (state: string) => void) => {
        expect(type).toBe("change");
        handler = cb;
        return { remove };
      }) as any);
    const device = createDeviceLocation();
    const listener = jest.fn();

    const unsubscribe = device.onForeground(listener);
    handler("background");
    handler("inactive");
    expect(listener).not.toHaveBeenCalled();
    handler("active");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
    add.mockRestore();
  });
});

describe("the Mapbox token", () => {
  it("is read from the Expo config extra and is empty when the build has none", () => {
    // jest-expo's default config has no `extra.MAPBOX_ACCESS_TOKEN`.
    expect(getMapboxAccessToken()).toBe("");
  });
});
