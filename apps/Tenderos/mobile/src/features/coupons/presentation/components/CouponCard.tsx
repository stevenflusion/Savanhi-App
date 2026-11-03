import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { Coupon } from "@repo/api-contracts";
import { Image, Pressable, Text, View } from "react-native";

import { formatDateOnlyRange } from "@/src/lib/date-only";

import { categoryIconFor } from "../../domain/category-icons";
import {
  couponStockLabel,
  couponTypeLabel,
  couponValueLabel,
} from "../../domain/coupon-labels";

/**
 * One coupon as the tendero's list shows it.
 *
 * S5 display acceptance: the coupon's OWN photo when it has one, and otherwise
 * the category icon of its FIRST product; every product line carries its own
 * category icon beside the name. There is no product image anywhere (S10).
 *
 * S11: nothing rendered here comes from an id, and the validity goes through
 * the shared date-only formatter, so no clock time can reach the screen.
 */
export function CouponCard({
  coupon,
  busy,
  onEdit,
  onTogglePaused,
}: {
  coupon: Coupon;
  busy: boolean;
  onEdit: () => void;
  onTogglePaused: () => void;
}) {
  const firstProduct = coupon.products[0];

  return (
    <View className="w-full max-w-xl self-center rounded-3xl bg-white p-4 shadow-sm">
      <View className="flex-row items-center gap-3">
        {coupon.imageUrl ? (
          <Image
            testID="coupon-photo"
            source={{ uri: coupon.imageUrl }}
            className="h-16 w-16 rounded-2xl"
          />
        ) : (
          <View
            testID="coupon-category-icon"
            className="h-16 w-16 items-center justify-center rounded-2xl bg-orange-50"
          >
            <MaterialCommunityIcons
              name={categoryIconFor(firstProduct?.category)}
              size={28}
              color="#1f2937"
            />
          </View>
        )}

        <View className="min-w-0 flex-1">
          <Text
            numberOfLines={1}
            className="text-base font-semibold text-slate-900"
          >
            {coupon.title}
          </Text>
          <Text numberOfLines={2} className="mt-0.5 text-sm text-slate-500">
            {couponValueLabel(coupon)}
          </Text>
        </View>
      </View>

      <View className="mt-3 flex-row flex-wrap items-center gap-2">
        <Chip label={couponTypeLabel(coupon.type)} />
        {coupon.paused ? <Chip label="En pausa" tone="warning" /> : null}
      </View>

      <View className="mt-3 flex-row items-center gap-2">
        <MaterialCommunityIcons
          name="calendar-blank-outline"
          size={16}
          color="#64748b"
        />
        <Text className="text-sm text-slate-600">
          {formatDateOnlyRange(coupon.validFrom, coupon.validTo)}
        </Text>
      </View>

      <Text className="mt-1 text-sm font-semibold text-slate-900">
        {couponStockLabel(coupon)}
      </Text>

      {coupon.products.length ? (
        <View className="mt-3 gap-1.5">
          {coupon.products.map((product) => (
            <View
              key={`${product.source}:${product.productId}`}
              className="flex-row items-center gap-2"
            >
              <MaterialCommunityIcons
                name={categoryIconFor(product.category)}
                size={16}
                color="#64748b"
              />
              <Text numberOfLines={1} className="flex-1 text-sm text-slate-700">
                {product.name}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className="mt-4 flex-row gap-2">
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onTogglePaused}
          className="min-h-[44px] flex-1 items-center justify-center rounded-full border border-slate-200 bg-white px-4"
        >
          <Text className="text-sm font-semibold text-slate-900">
            {coupon.paused ? "Activar" : "Pausar"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onEdit}
          className="min-h-[44px] flex-1 items-center justify-center rounded-full bg-black px-4"
        >
          <Text className="text-sm font-semibold text-white">Editar</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Chip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <View
      className={`rounded-full px-3 py-1 ${
        tone === "warning" ? "bg-amber-100" : "bg-slate-100"
      }`}
    >
      <Text
        className={`text-xs font-semibold ${
          tone === "warning" ? "text-amber-800" : "text-slate-700"
        }`}
      >
        {label}
      </Text>
    </View>
  );
}
