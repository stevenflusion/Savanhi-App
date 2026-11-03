import type { Coupon, CouponRedemption } from "@repo/api-contracts";

import { createCouponRedemptionsFetchRepository } from "@/src/features/coupons/infrastructure/coupon-redemptions-fetch-repository";

const QR_TOKEN = "Zm9vYmFyLXRva2VuLW5vdC1yZW5kZXJlZC1hbnl3aGVyZQ";
const PREVIEW_PATH = "/api/v1/tenderos/coupon-redemptions/preview";
const REDEEM_PATH = "/api/v1/tenderos/coupon-redemptions";

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
  products: [],
};

const REDEMPTION: CouponRedemption = {
  claimId: "33333333-3333-4333-8333-333333333333",
  status: "claimed",
  redeemedOn: null,
  customerName: "Rosa",
  coupon: COUPON,
  store: { id: COUPON.storeId, name: "Tienda Doña Rosa" },
};

type Call = { path: string; init?: RequestInit };

/**
 * A fake of the authenticated JSON transport the AuthProvider owns, in the same
 * shape `coupons-repository.test.ts` already uses: every call is recorded and
 * answered from a routing table, so the repository is exercised without a
 * network, a session or a React tree.
 */
function createTransport(
  answers: Record<
    string,
    | { success: true; data: unknown }
    | { success: false; error: string }
    | undefined
  > = {},
  options: { unparseable?: boolean } = {},
) {
  const calls: Call[] = [];

  const request = async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    const key = `${String(init?.method ?? "GET")} ${path}`;
    const answer = answers[key];
    if (!answer) {
      return { success: false as const, error: `No route for ${key}` };
    }
    if (!answer.success) {
      return { success: false as const, error: answer.error };
    }
    return {
      success: true as const,
      response: {
        json: async () => {
          if (options.unparseable) throw new Error("not json");
          return { data: answer.data };
        },
      } as unknown as Response,
    };
  };

  return { request, calls };
}

const body = (call: Call) => JSON.parse(String(call.init?.body ?? "null"));

describe("createCouponRedemptionsFetchRepository", () => {
  it("previews a scan on the preview route, with the token only in the body", async () => {
    const { request, calls } = createTransport({
      [`POST ${PREVIEW_PATH}`]: { success: true, data: REDEMPTION },
    });

    const result =
      await createCouponRedemptionsFetchRepository(request).previewRedemption(
        QR_TOKEN,
      );

    expect(result).toEqual({ success: true, data: REDEMPTION });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(PREVIEW_PATH);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(body(calls[0]!)).toEqual({ qrToken: QR_TOKEN });
    // The token is a bearer secret: it travels in the body, never in the URL.
    expect(calls[0]?.path).not.toContain(QR_TOKEN);
  });

  it("redeems on the redemption route, with the token only in the body", async () => {
    const redeemed: CouponRedemption = {
      ...REDEMPTION,
      status: "redeemed",
      redeemedOn: "2026-11-03",
    };
    const { request, calls } = createTransport({
      [`POST ${REDEEM_PATH}`]: { success: true, data: redeemed },
    });

    const result =
      await createCouponRedemptionsFetchRepository(request).redeemCoupon(
        QR_TOKEN,
      );

    expect(result).toEqual({ success: true, data: redeemed });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(REDEEM_PATH);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(body(calls[0]!)).toEqual({ qrToken: QR_TOKEN });
    expect(calls[0]?.path).not.toContain(QR_TOKEN);
  });

  it("sends the body as JSON", async () => {
    const { request, calls } = createTransport({
      [`POST ${PREVIEW_PATH}`]: { success: true, data: REDEMPTION },
    });

    await createCouponRedemptionsFetchRepository(request).previewRedemption(
      QR_TOKEN,
    );

    expect(calls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json",
    });
  });

  /**
   * The coupon error table is the only place an English backend sentence
   * becomes Spanish, and every message the redemption routes can answer has to
   * be in it (T6).
   */
  it.each([
    ["No claim matches this QR code.", "Este código no es de un cupón de tu tienda."],
    ["This coupon has already been redeemed.", "Este cupón ya fue canjeado."],
    ["This coupon is no longer valid.", "Este cupón ya venció."],
    [
      "No se pudo conectar con el servidor.",
      "No se pudo conectar con el servidor.",
    ],
  ])("maps %s to its Spanish wording", async (apiError, spanish) => {
    const { request } = createTransport({
      [`POST ${PREVIEW_PATH}`]: { success: false, error: apiError },
    });

    const result =
      await createCouponRedemptionsFetchRepository(request).previewRedemption(
        QR_TOKEN,
      );

    expect(result).toEqual({ success: false, error: spanish });
  });

  it("maps the same messages on the redemption route", async () => {
    const { request } = createTransport({
      [`POST ${REDEEM_PATH}`]: {
        success: false,
        error: "This coupon has already been redeemed.",
      },
    });

    const result =
      await createCouponRedemptionsFetchRepository(request).redeemCoupon(
        QR_TOKEN,
      );

    expect(result).toEqual({
      success: false,
      error: "Este cupón ya fue canjeado.",
    });
  });

  /** An English sentence the table does not know is never shown raw. */
  it("falls back to its own Spanish wording for an unknown message", async () => {
    const { request } = createTransport({
      [`POST ${REDEEM_PATH}`]: {
        success: false,
        error: "Some constraint nobody mapped yet.",
      },
    });

    const result =
      await createCouponRedemptionsFetchRepository(request).redeemCoupon(
        QR_TOKEN,
      );

    expect(result.success).toBe(false);
    expect(result).toEqual({
      success: false,
      error: "No se pudo canjear el cupón. Escanea de nuevo.",
    });
  });

  it("treats a body it cannot read as a failure and never as an empty success", async () => {
    const { request } = createTransport(
      { [`POST ${PREVIEW_PATH}`]: { success: true, data: REDEMPTION } },
      { unparseable: true },
    );

    const result =
      await createCouponRedemptionsFetchRepository(request).previewRedemption(
        QR_TOKEN,
      );

    expect(result).toEqual({
      success: false,
      error: "No se pudo leer el código. Escanea de nuevo.",
    });
  });
});
