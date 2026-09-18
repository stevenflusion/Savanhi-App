import { Redirect, Tabs } from "expo-router";
import {
  createTabBarButton,
  useNavBarScreenOptions,
  renderNavIcon,
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
    <Tabs initialRouteName="index" screenOptions={navBarScreenOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Inicio",
          tabBarIcon: ({ color }: { color: string; size: number }) =>
            renderNavIcon("HOME", color),
          tabBarButton: (props) =>
            createTabBarButton(props.accessibilityState?.selected === true)(
              props,
            ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Productos",
          tabBarIcon: ({ color }: { color: string; size: number }) =>
            renderNavIcon("ORD", color),
          tabBarButton: (props) =>
            createTabBarButton(props.accessibilityState?.selected === true)(
              props,
            ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Perfil",
          tabBarIcon: ({ color }: { color: string; size: number }) =>
            renderNavIcon("PER", color),
          tabBarButton: (props) =>
            createTabBarButton(props.accessibilityState?.selected === true)(
              props,
            ),
        }}
      />
    </Tabs>
  );
}
