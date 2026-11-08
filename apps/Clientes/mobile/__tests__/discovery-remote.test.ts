import { createDiscoveryFetchRepository } from "@/src/features/discovery/infrastructure/discovery-fetch-repository";

const BASE = "http://api.test";
const STORE_ID = "ff86d66b-9498-42a9-8c96-9b9f58d7d4e0";

const feedItem = (o: Record<string, unknown> = {}) => ({
  coupon: {
    id: "f6d71e22-505e-4b1a-919c-70e70864582b",
    storeId: STORE_ID,
    type: "percentage",
    title: "15% en arroz",
    description: null,
    freeText: null,
    percentageValue: 15,
    fixedAmountValue: null,
    validFrom: "2026-11-01",
    validTo: "2026-11-25",
    totalStock: 40,
    claimedCount: 0,
    remainingStock: 40,
    paused: false,
    imageUrl: null,
    products: [],
  },
  store: {
    id: STORE_ID,
    name: "Minimarket El Vecino",
    address: null,
    latitude: null,
    longitude: null,
    distanceMeters: null,
    distanceKm: null,
  },
  followed: true,
  claimed: false,
  ...o,
});

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

let fetchMock: jest.Mock;
const repo = () => createDiscoveryFetchRepository({ getBaseUrl: () => BASE });

beforeEach(() => {
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
});

describe("getFeed", () => {
  it("is a bare GET with the bearer token and NO query string", async () => {
    fetchMock.mockResolvedValue(respond(200, { data: [feedItem()] }));

    const result = await repo().getFeed("tok-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/clientes/coupons/feed`);
    expect(url).not.toContain("?");
    expect((init?.method ?? "GET")).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
    expect(init.body).toBeUndefined();
    expect(result).toEqual({ success: true, data: [feedItem()] });
  });

  it("keeps the server's order and never filters or sorts", async () => {
    const a = feedItem();
    const b = feedItem({ followed: false });
    fetchMock.mockResolvedValue(respond(200, { data: [b, a] }));

    const result = await repo().getFeed("tok");

    expect(result).toEqual({ success: true, data: [b, a] });
  });

  it("treats a malformed body as a failure", async () => {
    for (const body of [
      {},
      { data: "nope" },
      { data: [{ coupon: null }] },
      { data: [feedItem({ followed: "yes" })] },
    ]) {
      fetchMock.mockResolvedValueOnce(respond(200, body));
      const result = await repo().getFeed("tok");
      expect(result.success).toBe(false);
    }
  });

  it("reports status, unauthorized and the eligibility code, never server text", async () => {
    fetchMock.mockResolvedValueOnce(
      respond(401, { error: "secret-server-text" }),
    );
    const unauthorized = await repo().getFeed("tok");
    expect(unauthorized).toMatchObject({
      success: false,
      status: 401,
      unauthorized: true,
    });

    fetchMock.mockResolvedValueOnce(
      respond(403, {
        error: "You do not have access to this resource.",
        details: { eligibility: "underage" },
      }),
    );
    const forbidden = await repo().getFeed("tok");
    expect(forbidden).toMatchObject({
      success: false,
      status: 403,
      unauthorized: false,
      eligibility: "underage",
    });

    for (const status of [400, 429, 502]) {
      fetchMock.mockResolvedValueOnce(
        respond(status, { error: "secret-server-text" }),
      );
      const failed = await repo().getFeed("tok");
      expect(failed).toMatchObject({ success: false, status });
      expect(JSON.stringify(failed)).not.toContain("secret-server-text");
    }
  });

  it("reports a network failure without a status", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    const result = await repo().getFeed("tok");

    expect(result).toMatchObject({ success: false, unauthorized: false });
    expect((result as { status?: number }).status).toBeUndefined();
  });
});

describe("getFollowedStores", () => {
  it("reads the followed list with the bearer token", async () => {
    const stores = [
      { id: STORE_ID, name: "Tienda", address: null, latitude: null, longitude: null },
    ];
    fetchMock.mockResolvedValue(respond(200, { data: stores }));

    const result = await repo().getFollowedStores("tok-2");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/clientes/stores/followed`);
    expect((init?.method ?? "GET")).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer tok-2");
    expect(result).toEqual({ success: true, data: stores });
  });

  it("treats a non-array body as a failure", async () => {
    fetchMock.mockResolvedValue(respond(200, { data: {} }));

    expect((await repo().getFollowedStores("tok")).success).toBe(false);
  });
});

describe("setFollow", () => {
  it("PUTs to follow and DELETEs to unfollow, with no body", async () => {
    fetchMock.mockResolvedValueOnce(
      respond(200, { data: { storeId: STORE_ID, following: true } }),
    );
    const follow = await repo().setFollow("tok", STORE_ID, true);
    fetchMock.mockResolvedValueOnce(
      respond(200, { data: { storeId: STORE_ID, following: false } }),
    );
    const unfollow = await repo().setFollow("tok", STORE_ID, false);

    const [putUrl, putInit] = fetchMock.mock.calls[0];
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1];
    expect(putUrl).toBe(`${BASE}/api/v1/clientes/stores/${STORE_ID}/follow`);
    expect(putInit.method).toBe("PUT");
    expect(deleteUrl).toBe(putUrl);
    expect(deleteInit.method).toBe("DELETE");
    expect(putInit.body).toBeUndefined();
    expect(deleteInit.body).toBeUndefined();
    expect(putInit.headers.Authorization).toBe("Bearer tok");
    expect(follow).toEqual({
      success: true,
      data: { storeId: STORE_ID, following: true },
    });
    expect(unfollow).toEqual({
      success: true,
      data: { storeId: STORE_ID, following: false },
    });
  });

  it("encodes an opaque id into the path", async () => {
    fetchMock.mockResolvedValue(
      respond(200, { data: { storeId: "a/b?c", following: true } }),
    );

    await repo().setFollow("tok", "a/b?c", true);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE}/api/v1/clientes/stores/a%2Fb%3Fc/follow`,
    );
  });

  it("refuses an answer about another store or without a boolean", async () => {
    for (const data of [
      { storeId: "other", following: true },
      { storeId: STORE_ID, following: "yes" },
      null,
    ]) {
      fetchMock.mockResolvedValueOnce(respond(200, { data }));
      expect((await repo().setFollow("tok", STORE_ID, true)).success).toBe(
        false,
      );
    }
  });

  it("fails on 404 and network errors without server text", async () => {
    fetchMock.mockResolvedValueOnce(
      respond(404, { error: "Store not found." }),
    );
    const missing = await repo().setFollow("tok", STORE_ID, true);
    expect(missing).toMatchObject({ success: false, status: 404 });
    expect(JSON.stringify(missing)).not.toContain("Store not found");

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await repo().setFollow("tok", STORE_ID, true)).toMatchObject({
      success: false,
      unauthorized: false,
    });
  });
});
