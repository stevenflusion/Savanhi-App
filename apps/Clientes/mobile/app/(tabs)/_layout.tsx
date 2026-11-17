import { Tabs } from "expo-router";

import { ClientNavBar, SCREEN_BACKGROUND } from "@/src/components/ClientNavBar";
import { AuthGuard } from "@/src/features/auth";
import { DiscoveryProvider } from "@/src/features/discovery";
import { WalletProvider } from "@/src/features/wallet";

export default function TabsLayout() {
  return (
    <AuthGuard area="tabs">
      {/* Inicio and Mapa stay mounted once opened, so they share one state;
          Inicio's claim action and Billetera share the wallet the same way. */}
      <DiscoveryProvider>
        <WalletProvider>
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
        </WalletProvider>
      </DiscoveryProvider>
    </AuthGuard>
  );
}
