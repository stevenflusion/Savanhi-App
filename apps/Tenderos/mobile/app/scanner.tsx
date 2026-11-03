import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * STUB — T9 replaces this whole screen.
 *
 * T8 only needs the route the floating bar's centre button pushes to exist, so
 * the button is reachable and testable now. The real scanner is T9's work: an
 * `expo-camera` QR reader (S3, authorized in L6) that submits the scanned token
 * to `POST /api/v1/tenderos/coupon-redemptions` (T6). No camera dependency is
 * added here.
 */
export default function ScannerScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-orange-50">
      <View className="flex-row items-center px-4 pt-2">
        <Pressable
          accessibilityLabel="Volver"
          accessibilityRole="button"
          onPress={() => router.back()}
          className="h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm"
        >
          <MaterialCommunityIcons
            name="chevron-left"
            size={24}
            color="#1f2937"
          />
        </Pressable>
        <Text className="flex-1 pr-11 text-center text-xl font-semibold text-slate-900">
          Escanear
        </Text>
      </View>

      <View className="flex-1 items-center justify-center gap-3 px-8">
        <View className="h-24 w-24 items-center justify-center rounded-3xl bg-white shadow-sm">
          <MaterialCommunityIcons name="scan-helper" size={44} color="#1f2937" />
        </View>
        <Text className="text-center text-base font-semibold text-slate-900">
          El escáner llega pronto
        </Text>
        <Text className="text-center text-sm text-slate-600">
          Aquí vas a leer el código QR del cliente para canjear su cupón.
        </Text>
      </View>
    </SafeAreaView>
  );
}
