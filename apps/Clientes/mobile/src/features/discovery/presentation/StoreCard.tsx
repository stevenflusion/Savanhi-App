import type { NearbyStore } from "@repo/api-contracts";
import { Pressable, Text, View } from "react-native";

import { DISCOVERY_COPY } from "../domain/copy";
import { formatDistance } from "../domain/format";

type Props = {
  store: NearbyStore;
  followed: boolean;
  pending: boolean;
  onToggleFollow: () => void;
};

/**
 * One nearby store. Every value is a field of the server item; no id or
 * coordinate is rendered. The follow control mirrors the one on the Inicio
 * cards and only the server's confirmation changes it.
 */
export default function StoreCard({
  store,
  followed,
  pending,
  onToggleFollow,
}: Props) {
  return (
    <View testID={`store-${store.name}`} className="mb-4 rounded-3xl bg-white p-5">
      <Text className="text-base font-medium text-slate-900">{store.name}</Text>
      {store.address ? (
        <Text className="text-sm text-slate-600">{store.address}</Text>
      ) : null}
      <Text className="text-sm text-slate-500">{formatDistance(store)}</Text>

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
