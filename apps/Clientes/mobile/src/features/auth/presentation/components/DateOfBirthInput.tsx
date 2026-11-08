import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";

import {
  isSegmentComplete,
  sanitizeSegment,
  type BirthDateParts,
  type BirthDateSegment,
} from "../../domain/birth-date";
import { GATE_COPY } from "../../domain/copy";

type Props = {
  value: BirthDateParts;
  onChange: (value: BirthDateParts) => void;
  invalid?: boolean;
  disabled?: boolean;
};

const ORDER: BirthDateSegment[] = ["day", "month", "year"];
const LABEL: Record<BirthDateSegment, string> = {
  day: GATE_COPY.dayLabel,
  month: GATE_COPY.monthLabel,
  year: GATE_COPY.yearLabel,
};
const WIDTH: Record<BirthDateSegment, string> = {
  day: "w-16",
  month: "w-16",
  year: "w-24",
};
const LENGTH: Record<BirthDateSegment, number> = { day: 2, month: 2, year: 4 };

/**
 * Three navigable fields shown like `04 / 11 / 2002`. A completed part moves
 * focus to the next, any part can be revisited, and an empty part hands focus
 * back to the previous one on backspace.
 */
export default function DateOfBirthInput({
  value,
  onChange,
  invalid,
  disabled,
}: Props) {
  const inputs = useRef<Partial<Record<BirthDateSegment, TextInput | null>>>(
    {},
  );
  const [active, setActive] = useState<BirthDateSegment | null>(null);

  const focusSegment = (segment: BirthDateSegment) => {
    setActive(segment);
    inputs.current[segment]?.focus();
  };

  const handleChange = (segment: BirthDateSegment, text: string) => {
    const next = sanitizeSegment(segment, text);
    onChange({ ...value, [segment]: next });

    const following = ORDER[ORDER.indexOf(segment) + 1];
    if (isSegmentComplete(segment, next) && following) {
      focusSegment(following);
    }
  };

  return (
    <View className="flex-row items-center">
      {ORDER.map((segment, index) => (
        <View key={segment} className="flex-row items-center">
          {index > 0 ? (
            <Text className="px-2 text-lg text-gray-500">/</Text>
          ) : null}
          <TextInput
            ref={(node) => {
              inputs.current[segment] = node;
            }}
            value={value[segment]}
            onChangeText={(text) => handleChange(segment, text)}
            onFocus={() => setActive(segment)}
            onBlur={() =>
              setActive((current) => (current === segment ? null : current))
            }
            onKeyPress={(event) => {
              const previous = ORDER[index - 1];
              if (
                event.nativeEvent.key === "Backspace" &&
                value[segment] === "" &&
                previous
              ) {
                focusSegment(previous);
              }
            }}
            editable={!disabled}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={LENGTH[segment]}
            placeholder={LABEL[segment]}
            placeholderTextColor="#9ca3af"
            accessibilityLabel={LABEL[segment]}
            accessibilityState={{ selected: active === segment }}
            className={`h-16 ${WIDTH[segment]} rounded-2xl border px-2 text-center text-lg text-gray-900 ${
              invalid ? "border-red-400" : "border-gray-900"
            }`}
          />
        </View>
      ))}
    </View>
  );
}
