import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { formatDateOnly, formatDateOnlyRange, todayDateOnly } from "@/src/lib/date-only";

import {
  MONTH_NAMES_ES,
  WEEKDAY_LABELS_ES,
  isDayBefore,
  monthGrid,
  monthLabel,
  monthOf,
  rangePositionOf,
  selectRangeDay,
  shiftMonth,
  type CalendarMonth,
  type DateRange,
  type RangePosition,
} from "../../domain/calendar";

/**
 * The coupon's validity window, picked on a calendar instead of typed (S13).
 *
 * It is plain React Native on purpose: a date picker is a dependency, and the
 * only thing a dependency would add here is a native modal the tendero has to
 * open twice — once per end of the range — when the whole point is choosing
 * both ends in ONE view.
 *
 * Every rule it applies lives in `domain/calendar.ts` and is asserted without
 * a React tree; this file only paints what those functions answer and reports
 * the new range to its parent. It holds exactly one piece of state, the month
 * on screen, because that is the only thing the FORM does not own.
 */
export function DateRangeCalendar({
  value,
  onChange,
  minDate,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
  /**
   * The earliest selectable day, or null for no limit at all. Creating passes
   * today; EDITING passes null, so a stored `validFrom` already in the past
   * stays selectable and is never rewritten (S13).
   */
  minDate: string | null;
}) {
  const today = todayDateOnly();
  // The window opens where the tendero left off: on the stored start's own
  // month when there is one, and on this month otherwise.
  const [visible, setVisible] = useState<CalendarMonth>(
    () => monthOf(value.from) ?? monthOf(today) ?? { year: 2026, month: 1 },
  );

  const weeks = monthGrid(visible);

  return (
    <View className="mt-2 rounded-2xl border border-slate-200 bg-white p-3">
      <View className="flex-row items-center justify-between">
        <MonthArrow
          label="Mes anterior"
          icon="chevron-left"
          onPress={() => setVisible((current) => shiftMonth(current, -1))}
        />
        <Text className="text-base font-semibold capitalize text-slate-900">
          {monthLabel(visible)}
        </Text>
        <MonthArrow
          label="Mes siguiente"
          icon="chevron-right"
          onPress={() => setVisible((current) => shiftMonth(current, 1))}
        />
      </View>

      <View className="mt-3 flex-row">
        {WEEKDAY_LABELS_ES.map((weekday, index) => (
          <View key={`${weekday}-${index}`} className="flex-1 items-center">
            <Text className="text-xs font-semibold text-slate-400">
              {weekday}
            </Text>
          </View>
        ))}
      </View>

      {weeks.map((week, weekIndex) => (
        <View key={`week-${weekIndex}`} className="mt-1 flex-row">
          {week.map((date, dayIndex) => {
            if (!date) {
              return (
                <View
                  key={`blank-${weekIndex}-${dayIndex}`}
                  className="h-10 flex-1"
                />
              );
            }
            return (
              <DayCell
                key={date}
                date={date}
                position={rangePositionOf(value, date)}
                disabled={isDayBefore(date, minDate)}
                isToday={date === today}
                onPress={() => onChange(selectRangeDay(value, date))}
              />
            );
          })}
        </View>
      ))}

      <Text className="mt-3 text-sm text-slate-600">
        {value.from && value.to
          ? formatDateOnlyRange(value.from, value.to)
          : value.from
            ? `Desde ${formatDateOnly(value.from)} · elige el último día`
            : "Elige el primer día de la vigencia"}
      </Text>
    </View>
  );
}

function MonthArrow({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: "chevron-left" | "chevron-right";
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="h-10 w-10 items-center justify-center rounded-full bg-slate-100"
    >
      <MaterialCommunityIcons name={icon} size={22} color="#1f2937" />
    </Pressable>
  );
}

/**
 * One day. The ends of the window are solid black and the days between them a
 * soft band, which is what makes a range readable at a glance; today keeps its
 * own ring so it stays findable even when it is not selected.
 */
function DayCell({
  date,
  position,
  disabled,
  isToday,
  onPress,
}: {
  date: string;
  position: RangePosition;
  disabled: boolean;
  isToday: boolean;
  onPress: () => void;
}) {
  const edge = position === "start" || position === "end" || position === "single";
  const inside = position === "inside";
  const dayNumber = Number(date.slice(8, 10));

  return (
    <Pressable
      testID={`calendar-day-${date}`}
      accessibilityRole="button"
      accessibilityLabel={`${dayNumber} de ${MONTH_NAMES_ES[Number(date.slice(5, 7)) - 1]}`}
      accessibilityState={{ disabled, selected: position !== "none" }}
      disabled={disabled}
      // The guard is repeated here and not only on the Pressable: a disabled
      // day must be unable to move the range even if something presses it
      // programmatically.
      onPress={() => {
        if (disabled) return;
        onPress();
      }}
      className={`h-10 flex-1 items-center justify-center ${
        inside ? "bg-slate-100" : ""
      }`}
    >
      <View
        className={`h-9 w-9 items-center justify-center rounded-full ${
          edge ? "bg-black" : isToday ? "border border-slate-900" : ""
        }`}
      >
        <Text
          className={`text-sm ${
            disabled
              ? "text-slate-300"
              : edge
                ? "font-semibold text-white"
                : isToday
                  ? "font-semibold text-slate-900"
                  : "text-slate-700"
          }`}
        >
          {dayNumber}
        </Text>
        {isToday ? <View testID={`calendar-today-${date}`} /> : null}
      </View>
    </Pressable>
  );
}
