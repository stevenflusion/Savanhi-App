import { Text, View } from "react-native";

import { RoundIconButton } from "@/src/components/design/RoundIconButton";

import { activeCouponsHeadline } from "../../domain/coupon-labels";

/**
 * The two-tone headline and the round black primary button beside it (S14).
 *
 * The number in it is the REAL count of the store's active coupons, so the
 * line changes by itself as coupons are created, paused or expire — that is
 * what "dinamicamente" asks for, and it is also why the copy lives in
 * `coupon-labels.ts` with its pluralisation asserted there instead of being
 * assembled in JSX.
 */
export function HomeHeadline({
  activeCount,
  onCreate,
}: {
  activeCount: number;
  onCreate: () => void;
}) {
  const headline = activeCouponsHeadline(activeCount);

  return (
    <View className="w-full max-w-xl flex-row items-center justify-between gap-3 self-center">
      <View className="min-w-0 flex-1">
        <Text className="text-3xl font-light tracking-tight text-slate-400">
          {headline.lead}
        </Text>
        <Text className="text-3xl font-semibold tracking-tight text-slate-900">
          {headline.emphasis}
        </Text>
      </View>
      <RoundIconButton
        testID="create-coupon-button"
        icon="plus"
        label="Nuevo cupón"
        onPress={onCreate}
        size={56}
      />
    </View>
  );
}
