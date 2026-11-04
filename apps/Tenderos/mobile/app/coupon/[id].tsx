import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { CouponDetailScreen } from "@/src/features/coupons/presentation/screens/CouponDetailScreen";

/**
 * The coupon detail, OUTSIDE the tabs: it is pushed over the workspace and
 * carries its own back button, so it must not become a fifth destination in
 * the floating bar.
 *
 * The id travels in the path and is never rendered (S11).
 */
export default function CouponDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();

  return (
    <SafeAreaView className="flex-1 bg-orange-50">
      <CouponDetailScreen couponId={typeof id === "string" ? id : ""} />
    </SafeAreaView>
  );
}
