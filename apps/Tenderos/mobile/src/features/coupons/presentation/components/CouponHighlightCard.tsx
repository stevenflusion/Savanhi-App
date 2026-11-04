import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { Coupon } from "@repo/api-contracts";
import { Image, Text, View } from "react-native";

import { RoundIconButton } from "@/src/components/design/RoundIconButton";

import { categoryColorFor } from "../../domain/category-colors";
import { categoryIconFor } from "../../domain/category-icons";
import { couponHighlightValue } from "../../domain/coupon-labels";

/**
 * One active coupon as the Home carousel shows it (S14): a large rounded card
 * in the pastel of its first product's category, the coupon's own photo when
 * it has one and the category icon drawn large when it does not (S5), the
 * title, the type's own value and a small round button that opens the detail.
 *
 * The colour comes from the category's stable key through ONE mapping
 * (`category-colors.ts`), never from the coupon id and never from the category
 * name (S11).
 */
export function CouponHighlightCard({
  coupon,
  onOpen,
}: {
  coupon: Coupon;
  onOpen: () => void;
}) {
  const category = coupon.products[0]?.category ?? null;
  const colour = categoryColorFor(category);

  return (
    <View
      testID="coupon-highlight-card"
      style={{ backgroundColor: colour.surface }}
      className="overflow-hidden rounded-3xl p-4"
    >
      <View className="h-40 items-center justify-center">
        {coupon.imageUrl ? (
          <Image
            testID="coupon-highlight-photo"
            source={{ uri: coupon.imageUrl }}
            resizeMode="cover"
            className="h-40 w-full rounded-2xl"
          />
        ) : (
          <View testID="coupon-highlight-icon">
            <MaterialCommunityIcons
              name={categoryIconFor(category)}
              size={96}
              color={colour.ink}
            />
          </View>
        )}
      </View>

      <View className="mt-4 flex-row items-end justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text
            numberOfLines={2}
            style={{ color: colour.ink }}
            className="text-lg"
          >
            {coupon.title}
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: colour.ink }}
            className="mt-1 text-2xl font-semibold"
          >
            {couponHighlightValue(coupon)}
          </Text>
        </View>
        <RoundIconButton
          testID="open-coupon-detail"
          icon="arrow-top-right"
          label={`Ver ${coupon.title}`}
          onPress={onOpen}
          tone="light"
          size={44}
        />
      </View>
    </View>
  );
}
