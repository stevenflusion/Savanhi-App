import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { Coupon } from "@repo/api-contracts";
import { Pressable, Text, View } from "react-native";

import { SnapCarousel } from "@/src/components/design/SnapCarousel";

import { CouponHighlightCard } from "./CouponHighlightCard";

/**
 * The store's ACTIVE coupons, one card at a time with the next one peeking
 * (S14). Paused and expired coupons are not here — they are not doing
 * anything, and the Home tab is about what is live right now.
 *
 * An empty list is NOT an empty carousel: a store with nothing active gets one
 * card that says so and offers the only useful next step. That is a real state
 * (a brand new store, or one whose coupons all ended), not a placeholder.
 */
export function ActiveCouponsCarousel({
  coupons,
  onOpen,
  onCreate,
}: {
  coupons: Coupon[];
  onOpen: (coupon: Coupon) => void;
  onCreate: () => void;
}) {
  if (!coupons.length) {
    return (
      <View className="w-full max-w-xl self-center rounded-3xl bg-white p-5 shadow-sm">
        <MaterialCommunityIcons
          name="ticket-percent-outline"
          size={44}
          color="#1f2937"
        />
        <Text className="mt-3 text-lg font-semibold text-slate-900">
          Aún no tienes cupones activos
        </Text>
        <Text className="mt-1 text-sm text-slate-500">
          Publica uno para que tus clientes lo reclamen y lo canjeen en tu
          tienda.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onCreate}
          className="mt-4 min-h-[52px] items-center justify-center rounded-full bg-black px-5"
        >
          <Text className="text-base font-semibold text-white">
            Crear mi primer cupón
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="-mx-4">
      <SnapCarousel
        testID="active-coupons-carousel"
        data={coupons}
        keyExtractor={(coupon) => coupon.id}
        renderItem={(coupon) => (
          <CouponHighlightCard coupon={coupon} onOpen={() => onOpen(coupon)} />
        )}
      />
    </View>
  );
}
