process.env.TZ = "America/Bogota";

import type { Coupon, CouponRedemption } from "@repo/api-contracts";
import React from "react";
import { render } from "@testing-library/react-native";

import { RedemptionSuccess } from "@/src/features/coupons/presentation/components/RedemptionSuccess";

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

const redemption = (
  overrides: Partial<CouponRedemption> = {},
): CouponRedemption => ({
  claimId: "33333333-3333-4333-8333-333333333333",
  status: "redeemed",
  redeemedOn: "2026-11-03",
  customerName: "Rosa",
  coupon: COUPON,
  store: { id: COUPON.storeId, name: "Tienda Doña Rosa" },
  ...overrides,
});

const renderSuccess = (value: CouponRedemption) =>
  render(
    <RedemptionSuccess
      redemption={value}
      onScanAnother={jest.fn()}
      onClose={jest.fn()}
    />,
  );

describe("RedemptionSuccess", () => {
  it("confirms the day the coupon was redeemed", () => {
    const screen = renderSuccess(redemption());

    expect(screen.getByText("Canjeado el 3 nov 2026")).toBeTruthy();
  });

  /**
   * `redeemedOn` is `string | null` in the contract — the preview answers null
   * — so a half-written sentence is reachable rather than theoretical. The
   * line goes away entirely instead of reading "Canjeado el Sin fecha".
   */
  it("renders no date line at all when the API carried no date", () => {
    const screen = renderSuccess(redemption({ redeemedOn: null }));

    expect(screen.getByText("¡Cupón canjeado!")).toBeTruthy();
    expect(screen.queryByText(/Canjeado el/)).toBeNull();
    expect(screen.queryByText(/Sin fecha/)).toBeNull();
  });
});
