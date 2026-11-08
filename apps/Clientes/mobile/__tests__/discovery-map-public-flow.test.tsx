import * as Location from "expo-location";

import {
  COPY,
  NEAR_A,
  NEARBY,
  FEED,
  POS_1,
  POS_2,
  blurMap,
  callsTo,
  deferred,
  emitActiveState,
  focusMap,
  getPosition,
  hostNodes,
  installMapHarness,
  mapViews,
  mapa,
  noOsCalls,
  openInicio,
  os,
  renderedText,
  requestPermission,
  settle,
} from "./discovery-map-test-utils";
import { act } from "@testing-library/react-native";

installMapHarness();

const getPermission = Location.getForegroundPermissionsAsync as jest.Mock;

/** Nothing nearby may be on screen, asked for, or sent to the feed. */
function expectNoNearbyAnywhere() {
  expect(mapViews()).toHaveLength(0);
  expect(hostNodes("PointAnnotation")).toHaveLength(0);
  // Inicio may still list the followed store's coupon; Mapa lists nothing.
  expect(mapa().queryByText(NEAR_A.name)).toBeNull();
  expect(mapa().getByText(COPY.denied)).toBeTruthy();
}

describe("revoking the permission while a reading is pending", () => {
  it("shows the denial at once and never publishes the reading that answers late", async () => {
    os.status = "granted";
    await openInicio();
    const reading = deferred<unknown>();
    os.position = () => reading.promise;
    await focusMap();
    await settle();
    expect(getPosition).toHaveBeenCalledTimes(1);

    os.status = "denied";
    await emitActiveState();
    await settle();

    // The status was read again although the old reading is still pending...
    expect(getPermission).toHaveBeenCalledTimes(2);
    // ...so the revocation is visible now, not after that reading answers.
    expectNoNearbyAnywhere();

    await act(async () => {
      reading.resolve({ coords: { ...POS_1 } });
    });
    await settle();

    expectNoNearbyAnywhere();
    expect(callsTo(NEARBY)).toHaveLength(0);
    for (const feed of callsTo(FEED)) expect(feed.query.has("lat")).toBe(false);
    for (const feed of callsTo(FEED)) expect(feed.query.has("lng")).toBe(false);
    // The OS was never asked again after the denial.
    expect(requestPermission).not.toHaveBeenCalled();
    expect(getPosition).toHaveBeenCalledTimes(1);
  });

  it("clears a held position immediately, even when the refresh never answers", async () => {
    os.status = "granted";
    await openInicio();
    await focusMap();
    await mapa().findByText(NEAR_A.name);
    const refresh = deferred<unknown>();
    os.position = () => refresh.promise;
    await blurMap();
    await focusMap();
    await settle();
    expect(getPosition).toHaveBeenCalledTimes(2);

    os.status = "denied";
    await emitActiveState();
    await settle();

    // `refresh` is never resolved in this test: nothing may depend on it.
    expectNoNearbyAnywhere();
    const feeds = callsTo(FEED);
    expect(feeds.at(-1)!.query.has("lat")).toBe(false);
    expect(callsTo(NEARBY)).toHaveLength(1);
  });

  it("lets a later grant read a new position while the old reading never settles", async () => {
    os.status = "granted";
    await openInicio();
    await focusMap();
    await mapa().findByText(NEAR_A.name);
    const stuck = deferred<unknown>();
    os.position = () => stuck.promise;
    await blurMap();
    await focusMap();
    await settle();

    os.status = "denied";
    await emitActiveState();
    await settle();
    expectNoNearbyAnywhere();

    os.status = "granted";
    os.position = () => Promise.resolve({ coords: { ...POS_2 } });
    await emitActiveState();
    await settle();

    expect(getPosition).toHaveBeenCalledTimes(3);
    expect(requestPermission).not.toHaveBeenCalled();
    const nearby = callsTo(NEARBY);
    expect(nearby).toHaveLength(2);
    expect(nearby[1]!.query.get("lat")).toBe("-0.200000");
    expect(hostNodes("Camera")[0]!.props.centerCoordinate).toEqual([-78.5, -0.2]);

    // The stuck reading answers at last: it is from before the revocation.
    await act(async () => {
      stuck.resolve({ coords: { ...POS_1 } });
    });
    await settle();
    expect(hostNodes("Camera")[0]!.props.centerCoordinate).toEqual([-78.5, -0.2]);
    expect(callsTo(NEARBY)).toHaveLength(2);
  });
});

describe("one prompt, one reading", () => {
  it("a foreground return during the dialog neither prompts nor reads twice", async () => {
    await openInicio();
    noOsCalls();
    const dialog = deferred<void>();
    os.request = () => dialog.promise;
    await focusMap();
    await settle();
    await emitActiveState();
    await settle();
    expect(requestPermission).toHaveBeenCalledTimes(1);

    await act(async () => {
      dialog.resolve();
    });
    await settle();

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(getPosition).toHaveBeenCalledTimes(1);
    for (const call of getPosition.mock.calls) {
      expect(call[0].mayShowUserSettingsDialog).toBe(false);
    }
    expect(mapViews()).toHaveLength(1);
  });

  it("an undetermined status read before the dialog opens does not cancel the prompt", async () => {
    await openInicio();
    const firstRead = deferred<unknown>();
    getPermission.mockImplementationOnce(() => firstRead.promise);
    await focusMap();
    await settle();

    // The foreground read answers "undetermined" while Mapa's own pass has
    // not reached the dialog yet.
    await emitActiveState();
    await settle();
    expect(requestPermission).not.toHaveBeenCalled();

    await act(async () => {
      firstRead.resolve({ status: "undetermined", canAskAgain: true });
    });
    await settle();

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(mapViews()).toHaveLength(1);
    expect(renderedText()).not.toContain(COPY.denied);
  });
});
