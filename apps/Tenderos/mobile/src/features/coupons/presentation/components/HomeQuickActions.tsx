import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export type QuickAction = {
  id: string;
  label: string;
  icon: IconName;
  onPress: () => void;
};

/**
 * The 2x2 grid of pill shortcuts under the headline (S14).
 *
 * Every one of the four goes somewhere that already exists — nothing here is a
 * shortcut to a screen that has yet to be built.
 *
 * "Nuevo cupón" is deliberately NOT one of them: the round black button in the
 * headline is that action, and two affordances for one target in the same
 * screenful teaches the tendero nothing. The slot went to "Agregar producto"
 * instead, which is a real, separate target (`ProductsWorkspace` already
 * honours `intent=add`) and the thing a store with no products has to do
 * before it can create any coupon at all.
 */
export function HomeQuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <View className="w-full max-w-xl flex-row flex-wrap gap-2 self-center">
      {actions.map((action) => (
        <Pressable
          key={action.id}
          accessibilityRole="button"
          onPress={action.onPress}
          style={{ width: "48%" }}
          className="min-h-[52px] flex-row items-center gap-2 rounded-full bg-white px-4 shadow-sm"
        >
          <MaterialCommunityIcons
            name={action.icon}
            size={18}
            color="#1f2937"
          />
          <Text
            numberOfLines={1}
            className="flex-1 text-sm font-semibold text-slate-900"
          >
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
