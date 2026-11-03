import { Redirect, Tabs } from "expo-router";
import {
  FloatingTabBar,
  useNavBarScreenOptions,
} from "@/src/components/NavBar";
import { useAuth } from "@/src/features/auth";
import { getTabsLayoutRedirect } from "@/src/features/auth/domain/auth-navigation";

export default function TabsLayout() {
  const { user, onboardingDraft, onboardingStep, isReady } = useAuth();
  const navBarScreenOptions = useNavBarScreenOptions();
  if (!isReady) return null;
  const redirect = getTabsLayoutRedirect(user, onboardingDraft, onboardingStep);
  if (redirect) {
    return <Redirect href={redirect as never} />;
  }

  return (
    <Tabs
      initialRouteName="index"
      screenOptions={navBarScreenOptions}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Inicio",
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: "Productos",
        }}
      />
      {/* Orders are frozen for the cuponera MVP: the route file stays, the
          tab is hidden. `href: null` keeps it out of the tab bar. */}
      <Tabs.Screen name="orders" options={{ href: null }} />
      <Tabs.Screen
        name="coupons"
        options={{
          title: "Cupones",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Perfil",
        }}
      />
    </Tabs>
  );
}
