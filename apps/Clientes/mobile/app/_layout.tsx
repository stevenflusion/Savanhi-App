import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "@/src/features/auth";
import "../global.css";

export default function RootLayout() {
  const [fontsLoaded, fontsError] = useFonts({
    Poppins: require("../assets/fonts/Poppins.ttf"),
  });

  // Nothing renders before the font settles; a font error must not block the
  // app, so it falls back to the system font.
  if (!fontsLoaded && !fontsError) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
