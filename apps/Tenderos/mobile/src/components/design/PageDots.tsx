import { View } from "react-native";

/**
 * The dots under a carousel. The active one is a wider pill rather than a
 * bigger circle, which stays readable at the sizes a phone actually renders.
 *
 * It renders NOTHING for a single page: one dot tells the tendero nothing and
 * only takes vertical space away from the content.
 */
export function PageDots({
  count,
  activeIndex,
  testID = "page-dots",
}: {
  count: number;
  activeIndex: number;
  testID?: string;
}) {
  if (count < 2) return null;

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      className="flex-row items-center justify-center gap-1.5"
    >
      {Array.from({ length: count }, (_, index) => {
        const active = index === activeIndex;
        return (
          <View
            key={index}
            testID={`page-dot-${index}`}
            accessibilityState={{ selected: active }}
            style={{ width: active ? 18 : 6, height: 6, borderRadius: 3 }}
            className={active ? "bg-slate-900" : "bg-slate-300"}
          />
        );
      })}
    </View>
  );
}
