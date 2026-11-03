import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

type TabName = "index" | "products" | "orders" | "coupons" | "profile";

type TabDetails = {
  label: string;
  icon: IconName;
  activeIcon: IconName;
};

const tabDetails: Record<TabName, TabDetails> = {
  index: { label: "Inicio", icon: "home-variant-outline", activeIcon: "home-variant" },
  products: { label: "Productos", icon: "cube-outline", activeIcon: "cube" },
  orders: { label: "Pedidos", icon: "receipt", activeIcon: "receipt" },
  coupons: { label: "Cupones", icon: "ticket-outline", activeIcon: "ticket" },
  profile: { label: "Perfil", icon: "account-outline", activeIcon: "account" },
};

/**
 * Orders are frozen for the cuponera MVP (S12). Expo Router's `href: null`
 * only hides a route from the DEFAULT tab bar, so this custom bar keeps its own
 * list of what it renders — and the two halves it splits that list into, with
 * the scan button sitting between them.
 */
const LEFT_TABS: TabName[] = ["index", "products"];
const RIGHT_TABS: TabName[] = ["coupons", "profile"];

export function useNavBarScreenOptions() {
  const insets = useSafeAreaInsets();

  return {
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarStyle: {
      backgroundColor: "transparent",
      borderTopWidth: 0,
      elevation: 0,
      height: 92 + Math.max(insets.bottom, 8),
      padding: 0,
      position: "absolute" as const,
      left: 0,
      right: 0,
      bottom: 0,
    },
  };
}

type FloatingTabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: unknown;
};

/**
 * The floating pill bar: four icon-and-label tabs detached from the screen
 * edges, with one solid black circular scan button overlapping its centre.
 *
 * The scan button is the only control that LEAVES the tab navigator — it pushes
 * `/scanner`, a stack route — so it goes through the router while the four tabs
 * go through `navigation.navigate`.
 */
export function FloatingTabBar({ state, navigation }: FloatingTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const iconSize = width < 360 ? 20 : 22;
  const activeTab = state.routes[state.index]?.name as TabName | undefined;

  const navigate = (name: TabName) => {
    (
      navigation as unknown as { navigate: (route: string) => void }
    ).navigate(name);
  };

  const renderTab = (name: TabName) => {
    const route = state.routes.find((candidate) => candidate.name === name);
    if (!route) return null;
    return (
      <NavItem
        key={route.key}
        details={tabDetails[name]}
        focused={activeTab === name}
        iconSize={iconSize}
        onPress={() => navigate(name)}
      />
    );
  };

  return (
    <View
      className="absolute left-0 right-0 justify-end px-5"
      style={{
        bottom: 8,
        paddingBottom: Math.max(insets.bottom, 8),
        backgroundColor: "transparent",
        zIndex: 10,
        elevation: 10,
      }}
    >
      <View
        className="h-[68px] flex-row items-center rounded-full px-2 shadow-lg"
        style={{
          backgroundColor: "#fcfcfc",
          borderColor: "rgba(255, 255, 255, 0.85)",
          borderWidth: 1,
          shadowColor: "#0f172a",
          shadowOpacity: 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        {LEFT_TABS.map(renderTab)}

        <View className="w-16 items-center justify-center">
          <Pressable
            accessibilityLabel="Escanear"
            accessibilityHint="Abre el escáner para canjear un cupón"
            accessibilityRole="button"
            onPress={() => router.push("/scanner")}
            className="h-16 w-16 items-center justify-center rounded-full"
            style={{
              backgroundColor: "#0b0b0b",
              shadowColor: "#0f172a",
              shadowOpacity: 0.3,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 8,
              transform: [{ translateY: -10 }],
            }}
          >
            <MaterialCommunityIcons
              name="scan-helper"
              size={26}
              color="#ffffff"
            />
          </Pressable>
        </View>

        {RIGHT_TABS.map(renderTab)}
      </View>
    </View>
  );
}

function NavItem({
  details,
  focused,
  iconSize,
  onPress,
}: {
  details: TabDetails;
  focused: boolean;
  iconSize: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={details.label}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      className={`h-[56px] flex-1 items-center justify-center gap-0.5 rounded-full px-1 ${
        focused ? "bg-[#eceef3]" : ""
      }`}
    >
      <MaterialCommunityIcons
        name={focused ? details.activeIcon : details.icon}
        size={iconSize}
        color={focused ? "#111827" : "#8b94a3"}
      />
      <Text
        numberOfLines={1}
        className={`text-[11px] ${
          focused ? "font-semibold text-slate-900" : "text-slate-400"
        }`}
      >
        {details.label}
      </Text>
    </Pressable>
  );
}
