import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { CouponRedemption } from "@repo/api-contracts";
import { Pressable, Text, View } from "react-native";

import { categoryIconFor } from "../../domain/category-icons";
import { couponTypeLabel, couponValueLabel } from "../../domain/coupon-labels";

/** The customer may have no name at all until they complete a profile (T6). */
const NAMELESS_CUSTOMER = "Cliente sin nombre";

/**
 * What the scan WOULD redeem, as the tendero reads it at the counter: the
 * coupon's title, its type and the value of that type, the products the coupon
 * applies to with their category icons (S5, S10), and who is standing in front
 * of them.
 *
 * Nothing here comes from an id and no time is rendered (S11): the claim id,
 * the coupon id and the scanned token never reach the screen.
 */
export function RedemptionSheet({
  redemption,
  redeeming,
  onConfirm,
  onCancel,
}: {
  redemption: CouponRedemption;
  redeeming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { coupon } = redemption;
  const customerName = redemption.customerName?.trim() || NAMELESS_CUSTOMER;

  return (
    <View className="gap-4">
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
          <MaterialCommunityIcons name="check" size={22} color="#047857" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-medium text-emerald-700">
            Cupón válido
          </Text>
          <Text
            numberOfLines={2}
            className="text-lg font-semibold text-slate-900"
          >
            {coupon.title}
          </Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        <Chip label={couponTypeLabel(coupon.type)} />
        <Chip label={couponValueLabel(coupon)} />
      </View>

      <View className="gap-2">
        {coupon.products.map((product) => (
          <View
            key={`${product.source}:${product.productId}`}
            className="flex-row items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2.5"
          >
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-white">
              <MaterialCommunityIcons
                testID="redemption-product-icon"
                name={categoryIconFor(product.category)}
                size={20}
                color="#1f2937"
              />
            </View>
            <Text
              numberOfLines={1}
              className="flex-1 text-sm font-medium text-slate-800"
            >
              {product.name}
            </Text>
          </View>
        ))}
      </View>

      <View className="flex-row items-center gap-3">
        <MaterialCommunityIcons
          name="account-outline"
          size={18}
          color="#64748b"
        />
        <View className="min-w-0 flex-1">
          <Text className="text-xs text-slate-500">Cliente</Text>
          <Text numberOfLines={1} className="text-sm font-medium text-slate-800">
            {customerName}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: redeeming }}
        disabled={redeeming}
        onPress={onConfirm}
        className={`min-h-[56px] w-full items-center justify-center rounded-full px-5 ${
          redeeming ? "bg-slate-400" : "bg-black"
        }`}
      >
        <Text className="text-base font-semibold text-white">
          {redeeming ? "Canjeando..." : "Canjear"}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        disabled={redeeming}
        onPress={onCancel}
        className="min-h-[44px] w-full items-center justify-center"
      >
        <Text className="text-sm font-semibold text-slate-500">Cancelar</Text>
      </Pressable>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View className="rounded-full bg-slate-100 px-3 py-1.5">
      <Text className="text-xs font-semibold text-slate-700">{label}</Text>
    </View>
  );
}
