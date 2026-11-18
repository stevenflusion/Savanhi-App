import { Pressable, Text, View } from "react-native";

import { REMINDER_COPY } from "../domain/copy";
import { useCouponReminders } from "./reminders-context";

/**
 * The reminder opt-in of Billetera. It renders nothing while the choice is being
 * read, where the build or platform cannot send reminders, and where no provider
 * is mounted. Every action is explicit and offers its own result.
 */
export default function ReminderCard() {
  const reminders = useCouponReminders();
  if (!reminders) return null;
  const { status, enable, disable } = reminders;
  if (status === "checking" || status === "unavailable") return null;

  const action = (label: string, onPress: () => void, filled: boolean) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={
        filled
          ? "mt-3 h-12 items-center justify-center rounded-full bg-black"
          : "mt-3 h-12 items-center justify-center rounded-full border border-slate-300 bg-white"
      }
    >
      <Text className={filled ? "text-base text-white" : "text-base text-slate-900"}>
        {label}
      </Text>
    </Pressable>
  );

  let message: string | null = null;
  let control = null;
  if (status === "off") {
    message = REMINDER_COPY.off;
    control = action(REMINDER_COPY.enable, () => void enable(), true);
  } else if (status === "working") {
    control = (
      <View
        accessibilityRole="button"
        accessibilityState={{ busy: true, disabled: true }}
        className="mt-3 h-12 items-center justify-center rounded-full bg-slate-200"
      >
        <Text className="text-base text-slate-600">{REMINDER_COPY.working}</Text>
      </View>
    );
  } else if (status === "on") {
    message = REMINDER_COPY.on;
    control = action(REMINDER_COPY.disable, () => void disable(), false);
  } else if (status === "denied") {
    message = REMINDER_COPY.denied;
    control = action(REMINDER_COPY.retry, () => void enable(), true);
  } else if (status === "error") {
    message = REMINDER_COPY.error;
    control = action(REMINDER_COPY.retry, () => void enable(), true);
  } else {
    message = REMINDER_COPY.removeError;
    control = action(REMINDER_COPY.retry, () => void disable(), true);
  }

  return (
    <View className="mb-4 rounded-2xl bg-white p-4">
      <Text accessibilityRole="header" className="text-base font-semibold text-slate-900">
        {REMINDER_COPY.title}
      </Text>
      {message ? (
        <Text
          accessibilityRole={status === "on" || status === "off" ? undefined : "alert"}
          className="mt-1 text-sm text-slate-600"
        >
          {message}
        </Text>
      ) : null}
      {control}
    </View>
  );
}
