import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import type { ComponentProps } from "react";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, useWindowDimensions, View } from "react-native";
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

export function FloatingTabBar({ state, navigation }: FloatingTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const iconSize = width < 360 ? 20 : 22;
  const indicatorX = useRef(new Animated.Value(0)).current;
  const tabLayouts = useRef<Partial<Record<TabName, { x: number; width: number }>>>({});
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [indicatorWidth, setIndicatorWidth] = useState(0);
  const activeTab = state.routes[state.index]?.name as TabName | undefined;

  useEffect(() => {
    if (!activeTab) return;
    const layout = tabLayouts.current[activeTab];
    if (!layout) return;

    setIndicatorWidth(Math.max(layout.width - 20, 0));
    Animated.spring(indicatorX, {
      toValue: layout.x + 10,
      damping: 22,
      stiffness: 180,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [activeTab, indicatorX, layoutVersion]);

  const updateTabLayout = (name: TabName, x: number, width: number) => {
    tabLayouts.current[name] = { x, width };
    if (name === activeTab) {
      setLayoutVersion((version) => version + 1);
    }
  };

  const navigate = (name: TabName, params?: { intent?: "add" }) => {
    (
      navigation as unknown as {
        navigate: (route: string, routeParams?: { intent?: "add" }) => void;
      }
    ).navigate(name, params);
  };

  return (
    <View
      className="absolute left-0 right-0 justify-end px-6"
      style={{
        bottom: 8,
        paddingBottom: Math.max(insets.bottom, 8),
        backgroundColor: "transparent",
        zIndex: 10,
        elevation: 10,
      }}
    >
      <View
        className="h-14 flex-row items-center rounded-full px-1 shadow-lg"
        style={{
          backgroundColor: "#fcfcfc",
          borderColor: "rgba(255, 255, 255, 0.85)",
          borderWidth: 1,
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 5,
            left: 0,
            width: indicatorWidth,
            height: 38,
            borderRadius: 19,
            backgroundColor: "#e7e8ed",
            opacity: indicatorWidth ? 1 : 0,
            transform: [{ translateX: indicatorX }],
          }}
        />
        {state.routes.slice(0, 2).map((route, index) => {
          const details = tabDetails[route.name as TabName];
          const focused = state.index === index;
          return (
            <NavItem
              key={route.key}
              details={details}
              focused={focused}
              iconSize={iconSize}
              onLayout={(x, itemWidth) =>
                updateTabLayout(route.name as TabName, x, itemWidth)
              }
              onPress={() => navigate(route.name as TabName)}
            />
          );
        })}

        <Pressable
          accessibilityLabel="Agregar producto"
          accessibilityHint="Abre Productos para agregar un producto"
          accessibilityRole="button"
          className="h-12 w-12 items-center justify-center overflow-hidden rounded-full shadow-lg"
          onPress={() => navigate("products", { intent: "add" })}
          style={{ elevation: 6 }}
        >
          <LinearGradient
            colors={["#ffc15f", "#f9a43b", "#f39a2e"]}
            locations={[0, 0.55, 1]}
            start={{ x: 0.12, y: 0.08 }}
            end={{ x: 0.9, y: 0.95 }}
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              borderRadius: 24,
            }}
          />
          <LinearGradient
            colors={["rgba(255,255,255,0.32)", "rgba(255,255,255,0)", "rgba(255,255,255,0.2)"]}
            locations={[0, 0.48, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              borderRadius: 24,
            }}
          />
          <Ionicons name="add" size={29} color="#ffffff" />
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
              onLayout={(x, itemWidth) =>
                updateTabLayout(route.name as TabName, x, itemWidth)
              }
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
  onLayout,
  onPress,
}: {
  details: { label: string; icon: ComponentProps<typeof Ionicons>["name"] };
  focused: boolean;
  iconSize: number;
  onLayout: (x: number, width: number) => void;
  onPress: () => void;
}) {
  const color = focused ? "#111827" : "#64748b";

  return (
    <Pressable
      accessibilityLabel={details.label}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      className="h-12 flex-1 items-center justify-center rounded-full px-1"
      onLayout={(event) =>
        onLayout(event.nativeEvent.layout.x, event.nativeEvent.layout.width)
      }
      onPress={onPress}
    >
      <Ionicons
        name={focused ? details.icon.replace("-outline", "") as ComponentProps<typeof Ionicons>["name"] : details.icon}
        size={iconSize}
        color={color}
      />
    </Pressable>
  );
}
