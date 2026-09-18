import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type TabIconCode = "HOME" | "ORD" | "PER";

type TabBarButtonProps = {
  onPress?: ((...args: any[]) => void) | null;
  onLongPress?: ((...args: any[]) => void) | null;
  accessibilityState?: {
    selected?: boolean;
  };
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

type TabButtonProps = TabBarButtonProps & {
  isFocused: boolean;
};

function TabButton({ children, isFocused, style, ...props }: TabButtonProps) {
  return (
    <Pressable
      {...props}
      style={style}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      className={`mx-1 min-h-[44px] flex-1 items-center justify-center rounded-xl px-2 py-1 ${
        isFocused ? "bg-emerald-100" : "bg-transparent"
      }`}
      hitSlop={6}
    >
      <View
        className={`mb-1 h-1.5 w-6 rounded-full ${
          isFocused ? "bg-emerald-600" : "bg-transparent"
        }`}
      />
      {children}
    </Pressable>
  );
}

export function useNavBarScreenOptions() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = width < 360 ? 6 : 10;
  const safeBottom = Math.max(insets.bottom, 8);

  return {
    headerShown: false,
    tabBarActiveTintColor: "#047857",
    tabBarInactiveTintColor: "#6b7280",
    tabBarHideOnKeyboard: true,
    tabBarStyle: {
      backgroundColor: "#f8fafc",
      borderTopColor: "#e2e8f0",
      borderTopWidth: 1,
      height: 58 + safeBottom,
      paddingBottom: safeBottom,
      paddingTop: Math.max(6, Math.floor(insets.top * 0.04)),
      paddingHorizontal: horizontalPadding,
    },
    tabBarItemStyle: {
      minWidth: 0,
      flex: 1,
    },
    tabBarLabelStyle: {
      fontSize: width < 360 ? 10 : 11,
      fontWeight: "600" as const,
      letterSpacing: 0,
    },
  };
}

export function renderNavIcon(code: TabIconCode, color: string) {
  const map: Record<TabIconCode, string> = {
    HOME: "⌂",
    ORD: "▦",
    PER: "◉",
  };

  return (
    <View className="h-[18px] w-[18px] items-center justify-center">
      <Text style={{ color }} className="text-[14px] font-semibold">
        {map[code]}
      </Text>
    </View>
  );
}

export function createTabBarButton(isFocused: boolean) {
  return function Button(props: TabBarButtonProps) {
    return <TabButton {...props} isFocused={isFocused} />;
  };
}
