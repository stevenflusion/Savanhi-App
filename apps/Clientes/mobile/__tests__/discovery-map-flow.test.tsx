import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import * as Location from "expo-location";
import Mapbox from "@rnmapbox/maps";

import {
  COPY,
  COUPON_A,
  COUPON_B,
  FEED,
  FOLLOWED,
  FOLLOW_DELETE,
  FOLLOW_PUT,
  MiniApp,
  NEARBY,
  NEAR_A,
  POS_1,
  POS_2,
  PROFILE_GET,
  PUBLIC_TOKEN,
  STORE_A,
  STORE_B,
  acc,
  blurMap,
  calls,
  callsTo,
  deferred,
  emitActiveState,
  feedItem,
  focusMap,
  getPosition,
  hostNodes,
  inicio,
  mapViews,
  mapa,
  mockNav,
  nearbyStore,
  noOsCalls,
  openInicio,
  os,
  probeAuth,
  profile,
  ref,
  renderedText,
  reply,
  requestPermission,
  routes,
  seed,
  server,
  settle,
  user,
  installMapHarness,
} from "./discovery-map-test-utils";

installMapHarness();

// ---------------------------------------------------------------------------

describe("the first Inicio (C10)", () => {
  it("makes no permission, status or position call, even when the app returns to the foreground", async () => {
    await openInicio();
    await emitActiveState();
    await settle();

    noOsCalls();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    const feed = callsTo(FEED);
    expect(feed).toHaveLength(1);
    expect(feed[0]!.url).not.toContain("?");
    expect(callsTo(NEARBY)).toHaveLength(0);
  });
});

describe("opening Mapa", () => {
  it("asks the OS once, takes one reading, and draws the real nearby stores", async () => {
    await openInicio();
    await focusMap();

    expect(await mapa().findByText("Tienda Doña Rosa")).toBeTruthy();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(getPosition).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: false,
    });
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    expect(Location.hasServicesEnabledAsync).not.toHaveBeenCalled();

    const nearby = callsTo(NEARBY);
    expect(nearby).toHaveLength(1);
    expect([...nearby[0]!.query.keys()]).toEqual(["lat", "lng"]);
    expect(nearby[0]!.query.get("lat")).toBe("-0.180000");
    expect(nearby[0]!.query.get("lng")).toBe("-78.480000");

    expect(Mapbox.setAccessToken).toHaveBeenCalledWith(PUBLIC_TOKEN);
    expect(mapViews()).toHaveLength(1);
    const camera = hostNodes("Camera");
    expect(camera).toHaveLength(1);
    expect(camera[0]!.props.centerCoordinate).toEqual([-78.48, -0.18]);
  });

  it("puts one marker per real store at [longitude, latitude] and shows only real fields", async () => {
    await openInicio();
    await focusMap();
    await mapa().findByText("Tienda Doña Rosa");

    const markers = hostNodes("PointAnnotation");
    expect(markers.map((m: { props: any }) => m.props.coordinate)).toEqual([
      [-78.481, -0.181],
      [-78.49, -0.19],
    ]);
    expect(await mapa().findByText("Minimarket El Vecino")).toBeTruthy();
    expect(mapa().getByText("Tienda Doña Rosa, calle 1")).toBeTruthy();
    expect(mapa().getByText("A 350 m")).toBeTruthy();
    expect(mapa().getByText("A 1.2 km")).toBeTruthy();
    const text = renderedText();
    for (const secret of [STORE_A, STORE_B, "-0.181", "-78.481", "0.35"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("shows «Buscando tiendas cercanas…» and no map while the position is pending", async () => {
    const reading = deferred<unknown>();
    os.position = () => reading.promise;
    await openInicio();
    await focusMap();
    await settle();

    expect(mapa().getByText(COPY.searching)).toBeTruthy();
    expect(mapViews()).toHaveLength(0);
    expect(callsTo(NEARBY)).toHaveLength(0);

    await act(async () => {
      reading.resolve({ coords: { ...POS_1 } });
    });
    expect(await mapa().findByText("Tienda Doña Rosa")).toBeTruthy();
    expect(mapViews()).toHaveLength(1);
  });

  it("accepts an approximate grant as it is and never asks for precise", async () => {
    os.status = "granted";
    os.accuracy = "coarse";
    await openInicio();
    await focusMap();

    expect(await mapa().findByText("Tienda Doña Rosa")).toBeTruthy();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(getPosition).toHaveBeenCalledTimes(1);
  });
});

describe("a denied location permission", () => {
  it("shows the approved message only: no map, no request to the API, no control", async () => {
    os.onRequest = "denied";
    await openInicio();
    await focusMap();

    expect(await mapa().findByText(COPY.denied)).toBeTruthy();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(getPosition).not.toHaveBeenCalled();
    expect(mapViews()).toHaveLength(0);
    expect(callsTo(NEARBY)).toHaveLength(0);
    expect(mapa().queryAllByRole("button")).toHaveLength(0);
    expect(mapa().queryByText(COPY.retry)).toBeNull();
    expect(mapa().queryByText("Abrir ajustes")).toBeNull();
    expect(mapa().queryByText("Volver a Inicio")).toBeNull();
  });

  it("never asks again by itself, even when the OS would still allow it", async () => {
    os.onRequest = "denied";
    os.canAskAgain = true;
    await openInicio();
    await focusMap();
    await mapa().findByText(COPY.denied);

    await emitActiveState();
    await blurMap();
    await focusMap();
    await emitActiveState();
    await settle();

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(mapa().getByText(COPY.denied)).toBeTruthy();
    expect(getPosition).not.toHaveBeenCalled();
  });

  it("does not ask at all when the permission was already denied", async () => {
    os.status = "denied";
    os.canAskAgain = true;
    await openInicio();
    await focusMap();

    expect(await mapa().findByText(COPY.denied)).toBeTruthy();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("keeps Inicio working with the followed feed and no coordinates", async () => {
    os.onRequest = "denied";
    await openInicio();
    await focusMap();
    await mapa().findByText(COPY.denied);
    await settle();

    expect(inicio().getByText(COUPON_A)).toBeTruthy();
    for (const feed of callsTo(FEED)) expect(feed.url).not.toContain("?");
  });

  it("loads the position without a prompt after a later grant from the OS settings", async () => {
    os.status = "denied";
    await openInicio();
    await focusMap();
    await mapa().findByText(COPY.denied);

    os.status = "granted";
    await emitActiveState();

    expect(await mapa().findByText("Tienda Doña Rosa")).toBeTruthy();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(getPosition).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a foreground return if Mapa was never opened", async () => {
    os.status = "denied";
    await openInicio();
    os.status = "granted";
    await emitActiveState();
    await settle();

    noOsCalls();
  });
});

describe("the position and the OS keep a single owner", () => {
  it("coalesces a foreground return that arrives while the permission dialog is open", async () => {
    const dialog = deferred<void>();
    os.request = () => dialog.promise;
    await openInicio();
    await focusMap();
    await settle();

    await emitActiveState();
    await emitActiveState();
    await act(async () => {
      dialog.resolve();
    });

    expect(await mapa().findByText("Tienda Doña Rosa")).toBeTruthy();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(callsTo(NEARBY)).toHaveLength(1);
  });

  it("does not take a new reading on a foreground return while a position is held", async () => {
    await openInicio();
    await focusMap();
    await mapa().findByText("Tienda Doña Rosa");

    await emitActiveState();
    await settle();

    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(callsTo(NEARBY)).toHaveLength(1);
  });
});

describe("a position or service failure", () => {
  it("shows the approved error with «Reintentar» and one explicit retry reads once more", async () => {
    let attempt = 0;
    os.position = () =>
      ++attempt === 1
        ? Promise.reject(new Error("Location services are disabled"))
        : Promise.resolve({ coords: { ...POS_1 } });
    await openInicio();
    await focusMap();

    expect(await mapa().findByText(COPY.storesError)).toBeTruthy();
    expect(mapViews()).toHaveLength(0);
    expect(getPosition).toHaveBeenCalledTimes(1);

    fireEvent.press(mapa().getByText(COPY.retry));

    expect(await mapa().findByText("Tienda Doña Rosa")).toBeTruthy();
    expect(getPosition).toHaveBeenCalledTimes(2);
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("a foreground return after a failed reading tries once more, without any prompt", async () => {
    let attempt = 0;
    os.position = () =>
      ++attempt === 1
        ? Promise.reject(new Error("Location services are disabled"))
        : Promise.resolve({ coords: { ...POS_1 } });
    await openInicio();
    await focusMap();
    await mapa().findByText(COPY.retry);

    await emitActiveState();

    expect(await mapa().findByText("Tienda Doña Rosa")).toBeTruthy();
    expect(getPosition).toHaveBeenCalledTimes(2);
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe("the Mapbox token", () => {
  it("without a token draws no map, says so with the approved error and still lists the stores", async () => {
    (global as any).mockMapboxToken = "";
    await openInicio();
    await focusMap();

    expect(await mapa().findByText("Tienda Doña Rosa")).toBeTruthy();
    expect(mapa().getByText(COPY.storesError)).toBeTruthy();
    expect(mapa().queryByText(COPY.retry)).toBeNull();
    expect(mapViews()).toHaveLength(0);
    expect(Mapbox.setAccessToken).not.toHaveBeenCalled();
  });
});

describe("the nearby stores", () => {
  it("says «No hay tiendas cercanas» and still shows the map at the position", async () => {
    server.nearby = [];
    seed();
    routes.set(FOLLOWED, () => reply(200, { data: [] }));
    server.followed = new Set();
    routes.set(FEED, () => reply(200, { data: [] }));
    render(<MiniApp />);
    await screen.findByTestId("inicio");
    await focusMap();

    expect(await mapa().findByText(COPY.noStores)).toBeTruthy();
    expect(mapViews()).toHaveLength(1);
    expect(hostNodes("PointAnnotation")).toHaveLength(0);
  });

  it("shows the approved error with «Reintentar» when the stores cannot be read", async () => {
    let attempt = 0;
    routes.set(NEARBY, () =>
      ++attempt === 1 ? reply(502, { error: "Bad gateway" }) : reply(200, { data: [NEAR_A] }),
    );
    await openInicio();
    await focusMap();

    expect(await mapa().findByText(COPY.storesError)).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toContain("Bad gateway");

    fireEvent.press(mapa().getByText(COPY.retry));
    expect(await mapa().findByText("Tienda Doña Rosa")).toBeTruthy();
    expect(callsTo(NEARBY)).toHaveLength(2);
    expect(getPosition).toHaveBeenCalledTimes(1);
  });

  it("does not show «Siguiendo» it cannot know: a failed followed list is an error", async () => {
    routes.set(FOLLOWED, () => reply(500, { error: "boom" }));
    await openInicio();
    await focusMap();

    expect(await mapa().findByText(COPY.storesError)).toBeTruthy();
    expect(mapa().queryByText(COPY.following)).toBeNull();
    expect(mapa().queryByText(COPY.follow)).toBeNull();
  });
});

describe("following from Mapa", () => {
  it("changes only after the server confirms, coalesces taps, and Inicio follows", async () => {
    await openInicio();
    await focusMap();
    await mapa().findByText("Minimarket El Vecino");
    expect(inicio().queryByText(COUPON_B)).not.toBeNull();
    const feedBefore = callsTo(FEED).length;

    const gate = deferred();
    routes.set(FOLLOW_PUT(STORE_B), () => {
      server.followed.add(STORE_B);
      return gate.promise;
    });
    const storeB = () => within(mapa().getByTestId("store-Minimarket El Vecino"));
    fireEvent.press(storeB().getByText(COPY.follow));
    fireEvent.press(storeB().getByText(COPY.follow));
    await settle();

    expect(callsTo(FOLLOW_PUT(STORE_B))).toHaveLength(1);
    expect(storeB().queryByText(COPY.following)).toBeNull();

    await act(async () => {
      gate.resolve(reply(200, { data: { storeId: STORE_B, following: true } }));
    });
    await waitFor(() => expect(storeB().getByText(COPY.unfollow)).toBeTruthy());
    expect(storeB().getByText(COPY.following)).toBeTruthy();

    await settle();
    await settle();
    expect(callsTo(FEED).length).toBe(feedBefore + 1);
    expect(callsTo(NEARBY)).toHaveLength(1);
    expect(inicio().getByText(COUPON_B)).toBeTruthy();
  });

  it("keeps the previous state and shows the approved error when the server refuses", async () => {
    await openInicio();
    await focusMap();
    await mapa().findByText("Minimarket El Vecino");
    const feedBefore = callsTo(FEED).length;
    routes.set(FOLLOW_PUT(STORE_B), () => reply(502, { error: "Bad gateway" }));

    const card = within(mapa().getByTestId("store-Minimarket El Vecino"));
    fireEvent.press(card.getByText(COPY.follow));

    expect(await mapa().findByText(COPY.followError)).toBeTruthy();
    expect(card.getByText(COPY.follow)).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toContain("Bad gateway");
    await settle();
    expect(callsTo(FEED).length).toBe(feedBefore);
  });

  it("an unfollow made on Inicio is shown on the Mapa card without reading the stores again", async () => {
    await openInicio();
    await focusMap();
    await mapa().findByText("Tienda Doña Rosa");
    await inicio().findByText("A 350 m");

    const cardA = () => within(mapa().getByTestId("store-Tienda Doña Rosa"));
    expect(cardA().getByText(COPY.unfollow)).toBeTruthy();

    // Only the followed store's card offers «Dejar de seguir» on Inicio.
    fireEvent.press(inicio().getByText(COPY.unfollow));

    await waitFor(() => expect(cardA().getByText(COPY.follow)).toBeTruthy());
    expect(cardA().queryByText(COPY.following)).toBeNull();
    expect(callsTo(FOLLOW_DELETE(STORE_A))).toHaveLength(1);
    expect(callsTo(NEARBY)).toHaveLength(1);
  });
});

describe("sharing the position with Inicio", () => {
  it("sends exactly the lat/lng pair once a position exists, and shows the distances", async () => {
    await openInicio();
    expect(callsTo(FEED)).toHaveLength(1);

    await focusMap();
    await mapa().findByText("Tienda Doña Rosa");
    expect(await inicio().findByText(COUPON_B)).toBeTruthy();

    const feed = callsTo(FEED);
    expect(feed).toHaveLength(2);
    expect(feed[0]!.url).not.toContain("?");
    expect([...feed[1]!.query.keys()]).toEqual(["lat", "lng"]);
    expect(feed[1]!.query.get("lat")).toBe("-0.180000");
    expect(feed[1]!.query.get("lng")).toBe("-78.480000");
    expect(inicio().getByText("A 1.2 km")).toBeTruthy();
    await settle();
    expect(callsTo(FEED)).toHaveLength(2);
  });

  it("drops the position when the OS revokes it: no nearby UI, and Inicio asks without a query", async () => {
    await openInicio();
    await focusMap();
    await mapa().findByText("Tienda Doña Rosa");
    await inicio().findByText(COUPON_B);

    const reread = deferred();
    routes.set(FEED, () => reread.promise);
    os.status = "denied";
    await emitActiveState();

    expect(await mapa().findByText(COPY.denied)).toBeTruthy();
    expect(mapViews()).toHaveLength(0);
    expect(mapa().queryByText("Tienda Doña Rosa")).toBeNull();
    // While the followed-only read is pending, the nearby-only coupon and its
    // distance are not shown as if they were current.
    expect(inicio().queryByText(COUPON_B)).toBeNull();
    expect(inicio().queryByText("A 1.2 km")).toBeNull();
    expect(inicio().getByText(COPY.loadingCoupons)).toBeTruthy();

    await act(async () => {
      reread.resolve(
        reply(200, {
          data: [feedItem("c1111111-1111-4111-8111-111111111111", COUPON_A, NEAR_A, true, false)],
        }),
      );
    });
    expect(await inicio().findByText(COUPON_A)).toBeTruthy();
    expect(inicio().queryByText(COUPON_B)).toBeNull();
    const last = callsTo(FEED).at(-1)!;
    expect(last.url).not.toContain("?");
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("a newer position replaces the old one and an older answer cannot overwrite it", async () => {
    const first = deferred();
    let nearbyCalls = 0;
    routes.set(NEARBY, (c) => {
      nearbyCalls += 1;
      if (nearbyCalls === 1) return first.promise;
      return reply(200, {
        data: [nearbyStore(STORE_B, "Tienda Nueva", { distanceMeters: 90, distanceKm: 0.09 })],
      });
    });
    await openInicio();
    await focusMap();
    await waitFor(() => expect(callsTo(NEARBY)).toHaveLength(1));

    os.position = () => Promise.resolve({ coords: { ...POS_2 } });
    await blurMap();
    await focusMap();
    expect(await mapa().findByText("Tienda Nueva")).toBeTruthy();
    expect(callsTo(NEARBY)[1]!.query.get("lat")).toBe("-0.200000");

    await act(async () => {
      first.resolve(reply(200, { data: [NEAR_A] }));
    });
    await settle();
    expect(mapa().queryByText("Tienda Doña Rosa")).toBeNull();
    expect(mapa().getByText("Tienda Nueva")).toBeTruthy();
    expect(hostNodes("Camera")[0]!.props.centerCoordinate).toEqual([-78.5, -0.2]);
  });
});

describe("logout, a new login and a closed gate", () => {
  it("ignores a position that arrives after logout and makes no request with it", async () => {
    const reading = deferred<unknown>();
    os.position = () => reading.promise;
    await openInicio();
    await focusMap();
    await settle();
    routes.set("POST /auth/logout", () => reply(200, {}));

    await act(async () => {
      await probeAuth.logout();
    });
    await act(async () => {
      reading.resolve({ coords: { ...POS_1 } });
    });
    await settle();

    expect(callsTo(NEARBY)).toHaveLength(0);
    expect(screen.queryByTestId("mapa")).toBeNull();
    expect(mockNav.redirects.length).toBeGreaterThan(0);
  });

  it("ignores a nearby answer that arrives after logout", async () => {
    const answer = deferred();
    routes.set(NEARBY, () => answer.promise);
    await openInicio();
    await focusMap();
    await waitFor(() => expect(callsTo(NEARBY)).toHaveLength(1));
    routes.set("POST /auth/logout", () => reply(200, {}));

    await act(async () => {
      await probeAuth.logout();
    });
    await act(async () => {
      answer.resolve(reply(200, { data: [NEAR_A] }));
    });
    await settle();

    expect(screen.queryByText("Tienda Doña Rosa")).toBeNull();
    expect(callsTo(FOLLOWED)).toHaveLength(0);
  });

  it("a new login, even the same customer, starts with no position and no nearby data", async () => {
    await openInicio();
    await focusMap();
    await mapa().findByText("Tienda Doña Rosa");
    routes.set("POST /auth/logout", () => reply(200, {}));
    await act(async () => {
      await probeAuth.logout();
    });
    const positionsBefore = getPosition.mock.calls.length;
    const feedsBefore = callsTo(FEED).length;

    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: user(),
        session: { accessToken: acc(9), refreshToken: ref(9), expiresIn: 900 },
      }),
    );
    await act(async () => {
      await probeAuth.verifyOTP("cliente@example.test", "ch", "123456");
    });
    await act(async () => {
      mockNav.go("/");
    });
    await inicio().findByText(COUPON_A);

    expect(screen.queryByTestId("mapa")).toBeNull();
    expect(getPosition.mock.calls.length).toBe(positionsBefore);
    const fresh = callsTo(FEED).slice(feedsBefore);
    expect(fresh.length).toBeGreaterThan(0);
    for (const feed of fresh) expect(feed.url).not.toContain("?");
    expect(inicio().queryByText(COUPON_B)).toBeNull();
  });

  it("a 403 from the nearby read closes the gate once, without a loop or another reading", async () => {
    routes.set(NEARBY, () =>
      reply(403, { error: "x", details: { eligibility: "birth_date_required" } }),
    );
    await openInicio();
    let profileCalls = 0;
    routes.set(PROFILE_GET, () => {
      profileCalls += 1;
      return reply(200, {
        data: profile(
          profileCalls === 1 ? {} : { birthDate: null, eligibility: "birth_date_required" },
        ),
      });
    });
    await focusMap();

    await screen.findByTestId("auth-area:/auth/profile");
    await settle();
    await settle();

    expect(callsTo(NEARBY)).toHaveLength(1);
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("mapa")).toBeNull();
  });
});
