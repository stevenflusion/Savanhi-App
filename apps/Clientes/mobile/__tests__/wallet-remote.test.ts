import type { CustomerClaim } from "@repo/api-contracts";

import { createWalletFetchRepository } from "@/src/features/wallet/infrastructure/wallet-fetch-repository";

const BASE = "https://api.example.test";
const COUPON = "c1111111-1111-4111-8111-111111111111";
const CLAIM = "d1111111-1111-4111-8111-111111111111";
const TOKEN = "aB3-_xY9kLmN0pQrStUvWxYz1234567890AbCdEfGhI";

const claim = (o: Partial<CustomerClaim> = {}): CustomerClaim => ({
  id: CLAIM,
  status: "claimed",
  qrToken: null,
  claimedOn: "2026-11-10",
  redeemedOn: null,
  coupon: {
    id: COUPON,
    storeId: "e1",
    type: "percentage",
    title: "Arroz",
    description: null,
    freeText: null,
    percentageValue: 15,
    fixedAmountValue: null,
    validFrom: "2026-11-01",
    validTo: "2026-11-25",
    totalStock: 40,
    claimedCount: 1,
    remainingStock: 39,
    paused: false,
    imageUrl: null,
    products: [],
  },
  store: { id: "e1", name: "Tienda" },
  ...o,
});

type Init = RequestInit & { headers: Record<string, string> };
let seen: Array<{ url: string; init: Init }> = [];
function answer(status: number, body: unknown) {
  (global as any).fetch = jest.fn(async (url: string, init: Init) => {
    seen.push({ url, init });
    return { ok: status < 300, status, json: async () => body };
  });
}
const repo = () => createWalletFetchRepository({ getBaseUrl: () => BASE });

beforeEach(() => {
  seen = [];
});

describe("wallet repository", () => {
  it("claims with a bare authenticated POST and returns the 201 claim with its token", async () => {
    answer(201, { data: claim({ qrToken: TOKEN }) });
    const result = await repo().claimCoupon("access-1", COUPON);
    expect(result).toEqual({ success: true, data: claim({ qrToken: TOKEN }) });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`${BASE}/api/v1/clientes/coupons/${COUPON}/claims`);
    expect(seen[0]!.init.method).toBe("POST");
    expect(seen[0]!.init.headers).toEqual({ Authorization: "Bearer access-1" });
    expect(seen[0]!.init.body).toBeUndefined();
  });

  it("encodes ids into the path instead of trusting them", async () => {
    answer(201, { data: claim({ qrToken: TOKEN }) });
    await repo().claimCoupon("a", "x/../y");
    expect(seen[0]!.url).toBe(
      `${BASE}/api/v1/clientes/coupons/x%2F..%2Fy/claims`,
    );
  });

  it.each([
    ["a null token", claim({ qrToken: null })],
    ["a token that is a URL", claim({ qrToken: "https://x.example/abcdefghijklmnop" })],
    ["an unknown status", { ...claim({ qrToken: TOKEN }), status: "paused" }],
    ["a missing coupon", { ...claim({ qrToken: TOKEN }), coupon: undefined }],
  ])("refuses a 201 with %s as malformed", async (_label, data) => {
    answer(201, { data });
    const result = await repo().claimCoupon("a", COUPON);
    expect(result).toMatchObject({ success: false, status: 201 });
  });

  it("shows only a fixed message for a 409, never the server's text", async () => {
    answer(409, { error: "You have already claimed this coupon." });
    const result = await repo().claimCoupon("a", COUPON);
    expect(result).toMatchObject({ success: false, status: 409, unauthorized: false });
    expect(JSON.stringify(result)).not.toContain("already claimed");
  });

  it("flags a 401 and keeps the eligibility code of a 403", async () => {
    answer(401, {});
    expect(await repo().claimCoupon("a", COUPON)).toMatchObject({
      success: false,
      unauthorized: true,
    });
    answer(403, { error: "x", details: { eligibility: "underage" } });
    expect(await repo().claimCoupon("a", COUPON)).toMatchObject({
      success: false,
      status: 403,
      eligibility: "underage",
    });
  });

  it("answers a network failure without a status and without throwing", async () => {
    (global as any).fetch = jest.fn(async () => {
      throw new Error("offline");
    });
    const result = await repo().claimCoupon("a", COUPON);
    expect(result).toMatchObject({ success: false, unauthorized: false });
    expect((result as { status?: number }).status).toBeUndefined();
  });

  it("lists the wallet with a GET, in server order, with every token stripped", async () => {
    const second = { ...claim({ id: "d2" }), status: "released" as const };
    answer(200, { data: [claim({ qrToken: TOKEN }), second] });
    const result = await repo().listClaims("access-1");
    expect(seen[0]!.url).toBe(`${BASE}/api/v1/clientes/claims`);
    expect(seen[0]!.init.method ?? "GET").toBe("GET");
    expect(result.success && result.data.map((c) => c.id)).toEqual([CLAIM, "d2"]);
    expect(result.success && result.data.every((c) => c.qrToken === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("refuses a wallet list with one malformed claim", async () => {
    answer(200, { data: [claim(), { id: 5 }] });
    expect(await repo().listClaims("a")).toMatchObject({ success: false, status: 200 });
  });

  it("re-issues with a bare POST and returns the new token", async () => {
    answer(200, { data: claim({ qrToken: TOKEN }) });
    const result = await repo().reissueQr("access-1", CLAIM);
    expect(seen[0]!.url).toBe(`${BASE}/api/v1/clientes/claims/${CLAIM}/qr`);
    expect(seen[0]!.init.method).toBe("POST");
    expect(seen[0]!.init.body).toBeUndefined();
    expect(result).toEqual({ success: true, data: claim({ qrToken: TOKEN }) });
  });

  it("refuses a re-issue answer with no usable token", async () => {
    answer(200, { data: claim({ qrToken: null }) });
    expect(await repo().reissueQr("a", CLAIM)).toMatchObject({
      success: false,
      status: 200,
    });
  });

  it("passes the 409 of a redeemed, released or expired claim as a status only", async () => {
    answer(409, { error: "This claim was released and is no longer valid." });
    const result = await repo().reissueQr("a", CLAIM);
    expect(result).toMatchObject({ success: false, status: 409 });
    expect(JSON.stringify(result)).not.toContain("released");
  });
});
