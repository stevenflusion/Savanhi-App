import type { CustomerCouponFeedItem } from "@repo/api-contracts";
import { Pressable, Text, View } from "react-native";

import { DISCOVERY_COPY } from "../domain/copy";
import {
  describeBenefit,
  formatDistance,
  formatValidity,
} from "../domain/format";

type Props = {
  item: CustomerCouponFeedItem;
  followed: boolean;
  pending: boolean;
  onToggleFollow: () => void;
};

/**
 * One coupon of the feed. Every value is a field of the server item; no id or
 * time is rendered, and there is deliberately no claim action here: `claimed`
 * only means this customer already took the coupon, never that it is in the
 * wallet or can be taken again.
 */
export default function FeedCard({
  item,
  followed,
  pending,
  onToggleFollow,
}: Props) {
  const { coupon, store } = item;
  const benefit = describeBenefit(coupon);
  const validity = formatValidity(coupon.validFrom, coupon.validTo);

  return (
    <View className="mb-4 rounded-3xl bg-white p-5">
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 text-lg font-semibold text-slate-900">
          {coupon.title}
        </Text>
        {benefit ? (
          <Text className="text-lg font-semibold text-slate-900">
            {benefit}
          </Text>
        ) : null}
      </View>
      {coupon.description ? (
        <Text className="mt-1 text-sm text-slate-600">{coupon.description}</Text>
      ) : null}
      {validity ? (
        <Text className="mt-2 text-xs text-slate-500">{validity}</Text>
      ) : null}

      <View className="mt-3 border-t border-slate-100 pt-3">
        <Text className="text-base font-medium text-slate-900">
          {store.name}
        </Text>
        {store.address ? (
          <Text className="text-sm text-slate-600">{store.address}</Text>
        ) : null}
        <Text className="text-sm text-slate-500">{formatDistance(store)}</Text>
      </View>

      <View className="mt-3 flex-row items-center justify-between">
        {followed ? (
          <Text className="text-sm font-medium text-emerald-700">
            {DISCOVERY_COPY.following}
          </Text>
        ) : (
          <View />
        )}
        <Pressable
          onPress={onToggleFollow}
          disabled={pending}
          accessibilityRole="button"
          accessibilityState={{ busy: pending, disabled: pending }}
          className={`h-10 items-center justify-center rounded-full px-5 ${
            followed ? "border border-slate-300 bg-white" : "bg-black"
          } ${pending ? "opacity-50" : ""}`}
        >
          <Text
            className={`text-sm font-medium ${
              followed ? "text-slate-900" : "text-white"
            }`}
          >
            {followed ? DISCOVERY_COPY.unfollow : DISCOVERY_COPY.follow}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
