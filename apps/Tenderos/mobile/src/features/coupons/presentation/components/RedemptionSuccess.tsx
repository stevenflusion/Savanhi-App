import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { CouponRedemption } from "@repo/api-contracts";
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";

import { formatDateOnly, isDateOnly } from "@/src/lib/date-only";

/**
 * Fixed confetti, not random: the screen looks the same on every redemption,
 * which keeps it a confirmation rather than a surprise. Savanhi's own palette,
 * with black left to the primary action.
 */
const CONFETTI = [
  { left: "12%", top: "16%", color: "#f59e0b", rotate: "18deg" },
  { left: "26%", top: "8%", color: "#0ea5e9", rotate: "-24deg" },
  { left: "44%", top: "4%", color: "#10b981", rotate: "40deg" },
  { left: "68%", top: "9%", color: "#f43f5e", rotate: "-12deg" },
  { left: "84%", top: "18%", color: "#6366f1", rotate: "32deg" },
  { left: "8%", top: "34%", color: "#10b981", rotate: "-38deg" },
  { left: "88%", top: "36%", color: "#f59e0b", rotate: "22deg" },
] as const;

/**
 * The confirmation after a redemption actually committed.
 *
 * The date goes through the shared date-only helper, so the tendero reads the
 * DAY the coupon was redeemed and never a clock time (S11); the claim id and
 * the scanned token are not rendered at all.
 */
export function RedemptionSuccess({
  redemption,
  onScanAnother,
  onClose,
}: {
  redemption: CouponRedemption;
  onScanAnother: () => void;
  onClose: () => void;
}) {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  const scale = entrance.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1],
  });

  return (
    <View
      testID="redemption-success"
      className="absolute bottom-0 left-0 right-0 top-0 items-center justify-center bg-orange-50 px-8"
    >
      <View className="absolute bottom-0 left-0 right-0 top-0">
        {CONFETTI.map((piece) => (
          <View
            key={`${piece.left}-${piece.top}`}
            className="absolute h-2.5 w-1.5 rounded-sm"
            style={{
              left: piece.left,
              top: piece.top,
              backgroundColor: piece.color,
              opacity: 0.75,
              transform: [{ rotate: piece.rotate }],
            }}
          />
        ))}
      </View>

      <Animated.View
        style={{ transform: [{ scale }] }}
        className="h-32 w-32 items-center justify-center rounded-full border-4 border-emerald-100"
      >
        <View className="h-24 w-24 items-center justify-center rounded-full bg-emerald-500">
          <MaterialCommunityIcons name="check" size={52} color="#ffffff" />
        </View>
      </Animated.View>

      <Text className="mt-6 text-center text-2xl font-bold text-slate-900">
        ¡Cupón canjeado!
      </Text>
      <Text
        numberOfLines={2}
        className="mt-2 text-center text-base text-slate-600"
      >
        {redemption.coupon.title}
      </Text>
      {/*
        `redeemedOn` is nullable in the contract — the preview answers null —
        so the sentence is built only when there is a day to put in it. A
        half-written "Canjeado el Sin fecha" tells the tendero nothing.
      */}
      {isDateOnly(redemption.redeemedOn) ? (
        <Text className="mt-1 text-center text-sm text-slate-500">
          Canjeado el {formatDateOnly(redemption.redeemedOn)}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={onScanAnother}
        className="mt-8 min-h-[56px] w-full items-center justify-center rounded-full bg-black px-5"
      >
        <Text className="text-base font-semibold text-white">
          Escanear otro
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        className="mt-3 min-h-[44px] w-full items-center justify-center"
      >
        <Text className="text-sm font-semibold text-slate-500">Listo</Text>
      </Pressable>
    </View>
  );
}
