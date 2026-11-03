import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, Text, View } from "react-native";

/**
 * The circular back button and the centred title, in one component so the
 * permission states and the live camera cannot drift into two headers. Only
 * the title colour changes: the camera is dark behind it.
 */
export function ScannerHeader({
  onBack,
  tone = "light",
}: {
  onBack: () => void;
  tone?: "light" | "dark";
}) {
  return (
    <View className="flex-row items-center px-4 pt-2">
      <Pressable
        accessibilityLabel="Volver"
        accessibilityRole="button"
        onPress={onBack}
        className={`h-11 w-11 items-center justify-center rounded-full ${
          tone === "dark" ? "bg-white/90" : "bg-white shadow-sm"
        }`}
      >
        <MaterialCommunityIcons name="chevron-left" size={24} color="#1f2937" />
      </Pressable>
      <Text
        className={`flex-1 pr-11 text-center text-xl font-semibold ${
          tone === "dark" ? "text-white" : "text-slate-900"
        }`}
      >
        Escanear
      </Text>
    </View>
  );
}
