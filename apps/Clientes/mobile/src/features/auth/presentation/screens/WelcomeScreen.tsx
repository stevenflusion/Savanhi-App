import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { ImageBackground, Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EXAMPLE_LEGAL_URL } from "../../domain/copy";

const welcomeBackground = require("../../../../../assets/bgs/home.webp");

// Both labels open an EXAMPLE destination; final legal documents are pending.
// A device without a handler rejects, which must not crash the screen.
function openLegalLink() {
  Linking.openURL(EXAMPLE_LEGAL_URL).catch(() => undefined);
}

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ImageBackground
      source={welcomeBackground}
      resizeMode="cover"
      className="flex-1"
    >
      <View className="flex-1">
        <View
          className="flex-1 items-center px-6"
          style={{ paddingTop: insets.top + 100 }}
        >
          <Text
            className="text-7xl font-black tracking-[0.1em] text-[#747474]"
            style={{
              textShadowColor: "rgba(0, 0, 0, 0.22)",
              textShadowOffset: { width: 0, height: 2 },
              textShadowRadius: 3,
            }}
          >
            SAVANHI
          </Text>
        </View>

        <View className="px-6" style={{ paddingBottom: insets.bottom + 16 }}>
          <Pressable
            accessibilityRole="button"
            className="h-14 flex-row items-center justify-center rounded-full px-6"
            style={{
              backgroundColor: "#fef7ee",
              borderColor: "rgba(255, 255, 255, 0.55)",
              borderWidth: 1,
              shadowColor: "#3d2613",
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.16,
              shadowRadius: 8,
              elevation: 3,
            }}
            onPress={() => router.push("/auth/enter-email" as never)}
          >
            <MaterialIcons name="email" size={22} color="black" />
            <Text className="ml-3 text-base font-semibold tracking-wide text-[#0b0b0b]">
              Continuar con email
            </Text>
          </Pressable>

          <View className="mt-6">
            <Text
              className="text-center text-base leading-6 text-[#fef7ee]"
              style={{
                textShadowColor: "rgba(61, 38, 19, 0.9)",
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 4,
              }}
            >
              Al registrarte, aceptas nuestros{" "}
              <Text
                accessibilityRole="link"
                onPress={openLegalLink}
                className="font-bold text-[#fd9e2e]"
              >
                Términos
              </Text>{" "}
              y{" "}
              <Text
                accessibilityRole="link"
                onPress={openLegalLink}
                className="font-bold text-[#fd9e2e]"
              >
                Política de Privacidad
              </Text>
            </Text>
          </View>
        </View>
      </View>
    </ImageBackground>
  );
}
