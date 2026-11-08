import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function WalletScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 px-6" style={{ paddingTop: insets.top + 16 }}>
      <Text
        accessibilityRole="header"
        className="text-2xl font-semibold text-slate-900"
      >
        Billetera
      </Text>
    </View>
  );
}
