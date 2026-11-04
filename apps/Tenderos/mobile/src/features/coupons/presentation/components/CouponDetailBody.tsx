import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { Coupon } from "@repo/api-contracts";
import { Image, Text, View } from "react-native";

import { formatDateOnlyRange } from "@/src/lib/date-only";

import { categoryColorFor } from "../../domain/category-colors";
import { categoryIconFor } from "../../domain/category-icons";
import { couponTypeLabel, couponValueLabel } from "../../domain/coupon-labels";

/**
 * One page of the detail carousel: the coupon's photo, or the category icon of
 * its first product drawn large on that category's pastel (S5, S10, S14).
 *
 * It is the same decision `CouponHighlightCard` makes on the Home tab, taken
 * through the same two mappings, so a coupon cannot look like one thing in the
 * carousel and another on the detail.
 */
export function CouponDetailPage({ coupon }: { coupon: Coupon }) {
  const category = coupon.products[0]?.category ?? null;
  const colour = categoryColorFor(category);

  return (
    <View
      testID={`coupon-detail-page-${coupon.id}`}
      style={{ backgroundColor: colour.surface }}
      className="h-64 items-center justify-center overflow-hidden rounded-3xl"
    >
      {coupon.imageUrl ? (
        <Image
          testID="coupon-detail-photo"
          source={{ uri: coupon.imageUrl }}
          resizeMode="cover"
          className="h-64 w-full"
        />
      ) : (
        <MaterialCommunityIcons
          name={categoryIconFor(category)}
          size={128}
          color={colour.ink}
        />
      )}
    </View>
  );
}

/**
 * Everything under the carousel, for the coupon currently centred (S14).
 *
 * Every value here is a field of the coupon payload the tendero routes already
 * return, except `redeemedCount`, which `Coupon` does not carry — it comes
 * from the store metrics (T7) and is simply absent when that read did not come
 * back, rather than being guessed or shown as a zero the store did not earn.
 *
 * S11: no id and no time. The validity goes through the shared date-only
 * helper and the counts are counts.
 */
export function CouponDetailBody({
  coupon,
  redeemedCount,
}: {
  coupon: Coupon;
  redeemedCount: number | null;
}) {
  return (
    <View testID="coupon-detail-body" className="w-full max-w-xl self-center">
      <Text className="text-3xl font-semibold tracking-tight text-slate-900">
        {coupon.title}
      </Text>

      <View className="mt-3 flex-row flex-wrap items-center gap-2">
        <View className="rounded-full bg-slate-900 px-3 py-1.5">
          <Text className="text-sm font-semibold text-white">
            {couponValueLabel(coupon)}
          </Text>
        </View>
        <View className="rounded-full bg-slate-100 px-3 py-1.5">
          <Text className="text-sm font-semibold text-slate-700">
            {couponTypeLabel(coupon.type)}
          </Text>
        </View>
      </View>

      {coupon.description ? (
        <Text className="mt-3 text-base text-slate-500">
          {coupon.description}
        </Text>
      ) : null}

      <View className="mt-4 flex-row items-center gap-2">
        <MaterialCommunityIcons
          name="calendar-blank-outline"
          size={16}
          color="#64748b"
        />
        <Text className="text-sm text-slate-600">
          {formatDateOnlyRange(coupon.validFrom, coupon.validTo)}
        </Text>
      </View>

      {coupon.products.length ? (
        <View className="mt-4 gap-2">
          {coupon.products.map((product) => (
            <View
              key={`${product.source}:${product.productId}`}
              className="flex-row items-center gap-3 rounded-2xl bg-white px-3 py-3 shadow-sm"
            >
              <MaterialCommunityIcons
                name={categoryIconFor(product.category)}
                size={20}
                color="#1f2937"
              />
              <Text
                numberOfLines={1}
                className="flex-1 text-sm font-semibold text-slate-900"
              >
                {product.name}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className="mt-4 flex-row rounded-2xl bg-white py-4 shadow-sm">
        <Count label="Reclamados" value={coupon.claimedCount} />
        <Count label="Canjeados" value={redeemedCount} />
        <Count label="Disponibles" value={coupon.remainingStock} last />
      </View>
    </View>
  );
}

function Count({
  label,
  value,
  last = false,
}: {
  label: string;
  value: number | null;
  last?: boolean;
}) {
  return (
    <View
      className={`flex-1 items-center ${last ? "" : "border-r border-slate-100"}`}
    >
      <Text className="text-2xl font-semibold text-slate-900">
        {value === null ? "—" : String(value)}
      </Text>
      <Text className="mt-1 text-xs text-slate-500">{label}</Text>
    </View>
  );
}
