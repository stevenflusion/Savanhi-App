import { Pressable, ScrollView, Text } from "react-native";

type FilterTabsProps = {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  testID?: string;
};

/**
 * The category filter as a row of PILLS (S14): black for the one in force,
 * white for the rest, on the soft background the rest of the app uses.
 *
 * It scrolls horizontally instead of wrapping, because a store with a dozen
 * categories used to push the whole catalog off the first screenful.
 */
export function FilterTabs({
  options,
  value,
  onChange,
  testID,
}: FilterTabsProps) {
  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingRight: 8 }}
    >
      {options.map((option) => {
        const active = value === option;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option)}
            className={`min-h-[40px] items-center justify-center rounded-full px-4 ${
              active ? "bg-black" : "bg-white"
            }`}
          >
            <Text
              className={`text-sm font-semibold ${
                active ? "text-white" : "text-slate-700"
              }`}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
