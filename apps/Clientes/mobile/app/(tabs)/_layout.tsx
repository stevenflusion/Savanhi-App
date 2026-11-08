import { Tabs } from "expo-router";

import { ClientNavBar, SCREEN_BACKGROUND } from "@/src/components/ClientNavBar";
import { AuthGuard } from "@/src/features/auth";

export default function TabsLayout() {
  return (
    <AuthGuard area="tabs">
      <Tabs
        initialRouteName="index"
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: true,
          sceneStyle: { backgroundColor: SCREEN_BACKGROUND },
        }}
        tabBar={(props) => <ClientNavBar {...props} />}
      >
        <Tabs.Screen name="index" options={{ title: "Inicio" }} />
        <Tabs.Screen name="map" options={{ title: "Mapa" }} />
        <Tabs.Screen name="wallet" options={{ title: "Billetera" }} />
        <Tabs.Screen name="profile" options={{ title: "Perfil" }} />
      </Tabs>
    </AuthGuard>
  );
}
