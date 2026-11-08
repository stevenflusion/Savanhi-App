import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/features/auth";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();

  return (
    <View className="flex-1 px-6" style={{ paddingTop: insets.top + 16 }}>
      <Text
        accessibilityRole="header"
        className="text-2xl font-semibold text-slate-900"
      >
        Perfil
      </Text>
      <Pressable
        onPress={() => void logout()}
        accessibilityRole="button"
        className="mt-8 h-14 items-center justify-center rounded-full bg-slate-900"
      >
        <Text className="text-base text-white">Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}
