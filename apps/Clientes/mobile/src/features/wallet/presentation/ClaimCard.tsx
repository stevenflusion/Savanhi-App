import type { CustomerClaim } from "@repo/api-contracts";
import { Pressable, Text, View } from "react-native";

import { describeBenefit, formatValidity } from "@/src/features/discovery/domain/format";

import { canShowQr } from "../domain/claim";
import { STATUS_LABEL, WALLET_COPY } from "../domain/copy";

type Props = { claim: CustomerClaim; onViewQr: () => void };

/**
 * One claim of the wallet. Only the coupon, its validity (date only), the store
 * and the server's status are shown: no id, no clock time and no secret. «Ver QR»
 * is offered for an available claim and for nothing else.
 */
export default function ClaimCard({ claim, onViewQr }: Props) {
  const { coupon, store } = claim;
  const benefit = describeBenefit(coupon);
  const validity = formatValidity(coupon.validFrom, coupon.validTo);

  return (
    <View className="mb-4 rounded-3xl bg-white p-5">
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 text-lg font-semibold text-slate-900">
          {coupon.title}
        </Text>
        {benefit ? (
          <Text className="text-lg font-semibold text-slate-900">{benefit}</Text>
        ) : null}
      </View>
      {validity ? (
        <Text className="mt-2 text-xs text-slate-500">{validity}</Text>
      ) : null}
      <Text className="mt-3 text-base font-medium text-slate-900">
        {store.name}
      </Text>

      <View className="mt-3 flex-row items-center justify-between">
        <Text className="text-sm font-medium text-emerald-700">
          {STATUS_LABEL[claim.status]}
        </Text>
        {canShowQr(claim.status) ? (
          <Pressable
            onPress={onViewQr}
            accessibilityRole="button"
            className="h-10 items-center justify-center rounded-full bg-black px-5"
          >
            <Text className="text-sm font-medium text-white">
              {WALLET_COPY.viewQr}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
