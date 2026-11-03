import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MobileTopBar } from "@/src/components/MobileTopBar";
import { HomeMetricsScreen } from "@/src/features/coupons/presentation/screens/HomeMetricsScreen";

/**
 * The home tab. It used to render hardcoded sales, stock and alert figures;
 * it now renders what the store's coupons are actually doing, read from
 * `GET /api/v1/tenderos/stores/:storeId/metrics` (S9).
 */
export default function HomeTab() {
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 320,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, slide]);

  return (
    <SafeAreaView className="flex-1 bg-orange-50">
      <MobileTopBar
        title="Tu tienda hoy"
        subtitle="Cupones reclamados, canjes y seguidores"
      />
      <Animated.View
        className="flex-1"
        style={{ opacity: fade, transform: [{ translateY: slide }] }}
      >
        <HomeMetricsScreen />
      </Animated.View>
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}
