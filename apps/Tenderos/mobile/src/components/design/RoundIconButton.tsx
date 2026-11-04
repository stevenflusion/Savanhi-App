import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ComponentProps } from "react";
import { Pressable } from "react-native";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

/**
 * A circular icon button: the primary action of a screen when it is black, and
 * the back / secondary affordance when it is light.
 *
 * It lives in `components/design` and not inside the coupons feature because
 * the same button sits on the Home header, on the coupon detail and (T14) on
 * the Products and Profile screens. One file, one geometry, so the circles
 * cannot drift apart.
 *
 * `label` is the accessibility label and is never rendered as text — a round
 * button has no room for a caption, and a screen reader still needs one.
 */
export function RoundIconButton({
  icon,
  label,
  onPress,
  tone = "black",
  size = 48,
  disabled = false,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: "black" | "light";
  size?: number;
  disabled?: boolean;
  testID?: string;
}) {
  const black = tone === "black";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        opacity: disabled ? 0.5 : 1,
      }}
      className={`items-center justify-center ${
        black ? "bg-black" : "border border-slate-200 bg-white"
      }`}
    >
      <MaterialCommunityIcons
        name={icon}
        size={Math.round(size * 0.46)}
        color={black ? "#ffffff" : "#111827"}
      />
    </Pressable>
  );
}
