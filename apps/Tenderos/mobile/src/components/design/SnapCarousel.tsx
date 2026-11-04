import type { ReactNode } from "react";
import {
  ScrollView,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

/**
 * A horizontal carousel that snaps one card at a time and lets the next card
 * PEEK at the edge, which is what tells the tendero there is more to the right
 * without a scrollbar (S14).
 *
 * It is a plain `ScrollView` with `snapToInterval`, not a library and not a
 * `FlatList`: the Home tab shows a handful of coupons, the detail shows the
 * store's own list, and virtualisation buys nothing at that size while
 * costing the exact snapping control this needs.
 *
 * The page is reported from `onMomentumScrollEnd` — the index is derived from
 * the final offset, so a flick that crosses two cards reports the card it
 * actually landed on and never an interpolated one.
 */
export function SnapCarousel<T>({
  data,
  renderItem,
  keyExtractor,
  onPageChange,
  initialPage = 0,
  peek = 48,
  gap = 12,
  testID = "snap-carousel",
}: {
  data: T[];
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string;
  onPageChange?: (index: number) => void;
  /** Where the carousel opens. The detail screen opens on the tapped coupon. */
  initialPage?: number;
  /** How much of the next card stays visible. */
  peek?: number;
  gap?: number;
  testID?: string;
}) {
  const { width } = useWindowDimensions();
  const sidePadding = 16;
  const cardWidth = Math.max(width - sidePadding * 2 - peek, 160);
  const interval = cardWidth + gap;

  const handleMomentumEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    if (!onPageChange) return;
    const offset = event.nativeEvent.contentOffset?.x ?? 0;
    const index = Math.round(offset / interval);
    // Clamped, because iOS reports a negative offset while rubber-banding and
    // an index outside the data would read a card that does not exist.
    onPageChange(Math.min(Math.max(index, 0), Math.max(data.length - 1, 0)));
  };

  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      snapToInterval={interval}
      snapToAlignment="start"
      disableIntervalMomentum
      // The opening position is a PROP and not an imperative scroll: the
      // detail screen opens on the coupon the tendero tapped, and doing it
      // through a ref would show the first card for one frame first.
      contentOffset={{ x: initialPage * interval, y: 0 }}
      contentContainerStyle={{ paddingHorizontal: sidePadding, gap }}
      onMomentumScrollEnd={handleMomentumEnd}
    >
      {data.map((item, index) => (
        <View key={keyExtractor(item, index)} style={{ width: cardWidth }}>
          {renderItem(item, index)}
        </View>
      ))}
    </ScrollView>
  );
}
