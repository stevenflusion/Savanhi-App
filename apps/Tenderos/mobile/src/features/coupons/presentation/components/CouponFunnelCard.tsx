import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { CouponMetrics } from "@repo/api-contracts";
import { Text, View } from "react-native";

import {
  couponFunnelLabel,
  couponRemainingLabel,
  couponTypeLabel,
} from "../../domain/coupon-labels";
import { couponTypeIcon } from "../../domain/coupon-type-icons";

/**
 * Claimed against redeemed, one row per coupon (S9).
 *
 * The bar is the ratio of redeemed to CLAIMED and not to the total stock,
 * because the question the tendero is actually asking is "of the people who
 * took my coupon, how many came in?". A coupon nobody claimed yet shows an
 * empty bar rather than a full one.
 *
 * S11: the coupon id travels in the payload and is used as a list key only;
 * nothing rendered here comes from it, and a metrics row carries no date and
 * no time at all.
 */
export function CouponFunnelCard({ coupons }: { coupons: CouponMetrics[] }) {
  return (
    <View className="w-full max-w-xl self-center rounded-3xl bg-white p-4 shadow-sm">
      <Text className="text-base font-semibold text-slate-900">
        Reclamados y canjeados
      </Text>

      <View className="mt-3 gap-3">
        {coupons.map((coupon) => (
          <CouponFunnelRow key={coupon.couponId} coupon={coupon} />
        ))}
      </View>
    </View>
  );
}

function CouponFunnelRow({ coupon }: { coupon: CouponMetrics }) {
  const progress =
    coupon.claimedCount > 0
      ? Math.min(100, Math.round((coupon.redeemedCount / coupon.claimedCount) * 100))
      : 0;

  return (
    <View className="rounded-2xl bg-slate-50 p-3">
      <View className="flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white">
          <MaterialCommunityIcons
            testID="coupon-type-icon"
            name={couponTypeIcon(coupon.type)}
            size={22}
            color="#1f2937"
          />
        </View>

        <View className="min-w-0 flex-1">
          <Text
            numberOfLines={1}
            className="text-sm font-semibold text-slate-900"
          >
            {coupon.title}
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-xs text-slate-500">
            {couponTypeLabel(coupon.type)}
          </Text>
        </View>

        <View className="items-end">
          <Text className="text-lg font-bold text-slate-900">
            {coupon.redeemedCount}
          </Text>
          <Text className="text-[11px] text-slate-500">canjes</Text>
        </View>
      </View>

      <View className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <View
          testID="coupon-funnel-bar"
          className="h-2 rounded-full bg-emerald-500"
          style={{ width: `${progress}%` }}
        />
      </View>

      <View className="mt-2 flex-row items-center justify-between gap-2">
        <Text className="text-xs text-slate-600">
          {couponFunnelLabel(coupon.claimedCount, coupon.redeemedCount)}
        </Text>
        <Text className="text-xs font-medium text-slate-500">
          {couponRemainingLabel(coupon.remainingStock)}
        </Text>
      </View>
    </View>
  );
}
