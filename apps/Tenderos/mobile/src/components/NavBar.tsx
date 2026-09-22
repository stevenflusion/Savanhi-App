import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type TabName = "index" | "products" | "orders" | "profile";

const tabDetails: Record<
  TabName,
  { label: string; icon: ComponentProps<typeof Ionicons>["name"] }
> = {
  index: { label: "Inicio", icon: "home-outline" },
  products: { label: "Productos", icon: "cube-outline" },
  orders: { label: "Pedidos", icon: "receipt-outline" },
  profile: { label: "Perfil", icon: "person-outline" },
};

export function useNavBarScreenOptions() {
  const insets = useSafeAreaInsets();

  return {
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarStyle: {
      backgroundColor: "transparent",
      borderTopWidth: 0,
      elevation: 0,
      height: 84 + Math.max(insets.bottom, 8),
      padding: 0,
    },
  };
}

type FloatingTabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: unknown;
};

export function FloatingTabBar({ state, navigation }: FloatingTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const iconSize = width < 360 ? 20 : 22;
  const navigate = (name: TabName, params?: { intent?: "add" }) => {
    (
      navigation as unknown as {
        navigate: (route: string, routeParams?: { intent?: "add" }) => void;
      }
    ).navigate(name, params);
  };

  return (
    <View
      className="justify-end px-4"
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      <View className="h-16 flex-row items-center rounded-full border border-slate-200 bg-white px-1 shadow-lg">
        {state.routes.slice(0, 2).map((route, index) => {
          const details = tabDetails[route.name as TabName];
          const focused = state.index === index;
          return (
            <NavItem
              key={route.key}
              details={details}
              focused={focused}
              iconSize={iconSize}
              onPress={() => navigate(route.name as TabName)}
            />
          );
        })}

        <Pressable
          accessibilityLabel="Agregar producto"
          accessibilityHint="Abre Productos para agregar un producto"
          accessibilityRole="button"
          className="-mt-8 min-h-[52px] min-w-[52px] items-center justify-center rounded-full bg-emerald-600 shadow-lg"
          onPress={() => navigate("products", { intent: "add" })}
          style={{ elevation: 6 }}
        >
          <Ionicons name="add" size={30} color="#ffffff" />
        </Pressable>

        {state.routes.slice(2).map((route, index) => {
          const details = tabDetails[route.name as TabName];
          const focused = state.index === index + 2;
          return (
            <NavItem
              key={route.key}
              details={details}
              focused={focused}
              iconSize={iconSize}
              onPress={() => navigate(route.name as TabName)}
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
  details: { label: string; icon: ComponentProps<typeof Ionicons>["name"] };
  focused: boolean;
  iconSize: number;
  onPress: () => void;
}) {
  const color = focused ? "#047857" : "#64748b";

  return (
    <Pressable
      accessibilityLabel={details.label}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      className="min-h-[44px] flex-1 items-center justify-center gap-0.5 rounded-full px-1"
      onPress={onPress}
    >
      <Ionicons name={details.icon} size={iconSize} color={color} />
      <Text
        className={`text-[10px] ${focused ? "font-bold text-emerald-700" : "font-semibold text-slate-500"}`}
      >
        {details.label}
      </Text>
    </Pressable>
  );
}
