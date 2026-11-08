import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ComponentProps } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

type TabName = "index" | "map" | "wallet" | "profile";

type TabDetails = {
  label: string;
  icon: IconName;
  activeIcon: IconName;
};

/**
 * The four approved destinations (C6): Inicio is the ONE feed, Mapa the nearby
 * stores, Billetera the claimed coupons and Perfil the account. The route file
 * names are the keys; the Spanish labels are what the customer reads.
 */
const tabDetails: Record<TabName, TabDetails> = {
  index: {
    label: "Inicio",
    icon: "home-variant-outline",
    activeIcon: "home-variant",
  },
  map: { label: "Mapa", icon: "map-outline", activeIcon: "map" },
  wallet: { label: "Billetera", icon: "wallet-outline", activeIcon: "wallet" },
  profile: { label: "Perfil", icon: "account-outline", activeIcon: "account" },
};

/**
 * The bar renders its own list rather than every route the navigator holds, so
 * a route added later can never grow it past four destinations.
 */
const TABS: TabName[] = ["index", "map", "wallet", "profile"];

export const NAV_BAR_HEIGHT = 68;

/** Behind the bar and behind every screen, so the gap around the pill blends in. */
export const SCREEN_BACKGROUND = "#f6f7f9";

type ClientNavBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: unknown;
};

/**
 * A detached light pill with four icon-and-label targets and a raised active
 * item. It lives in the layout flow below the scene instead of floating over
 * it, so screen content ends above the bar and the system insets are honoured
 * without any per-screen padding.
 */
export function ClientNavBar({ state, navigation }: ClientNavBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const iconSize = width < 360 ? 20 : 22;
  const activeTab = state.routes[state.index]?.name;

  const navigate = (name: TabName) => {
    (navigation as { navigate: (route: string) => void }).navigate(name);
  };

  return (
    <View
      className="px-5 pt-2"
      style={{
        backgroundColor: SCREEN_BACKGROUND,
        paddingBottom: Math.max(insets.bottom, 8),
      }}
    >
      <View
        className="flex-row items-center rounded-full px-2"
        style={{
          height: NAV_BAR_HEIGHT,
          backgroundColor: "#ffffff",
          borderColor: "#e5e7eb",
          borderWidth: 1,
          shadowColor: "#0f172a",
          shadowOpacity: 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 8,
        }}
      >
        {TABS.map((name) => {
          const route = state.routes.find(
            (candidate) => candidate.name === name,
          );
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
        })}
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
      className="h-[56px] flex-1 items-center justify-center gap-0.5 rounded-full px-1"
      style={focused ? { backgroundColor: "#eef0f3" } : undefined}
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
