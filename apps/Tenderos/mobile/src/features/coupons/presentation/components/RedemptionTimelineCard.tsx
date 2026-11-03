import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { CouponRedemptionHistoryEntry } from "@repo/api-contracts";
import { Pressable, Text, View } from "react-native";

import { formatDateOnly } from "@/src/lib/date-only";

import { redemptionCustomerLabel } from "../../domain/coupon-labels";

/**
 * The store's redemption history as a timeline: one dot per redemption, joined
 * by a connector down the card.
 *
 * Two things it deliberately does NOT show. A clock time, because none exists:
 * `redeemed_on` is a DATE column and S11 keeps hours out of the product, so
 * the line reads `Rosa · 3 nov 2026` and the date goes through the shared
 * date-only helper. And the claim id, which is a list key and nothing else.
 *
 * The customer may genuinely have no name — an OTP-registered customer who
 * never completed a profile — so the app says so in its own Spanish rather
 * than inventing one.
 */
export function RedemptionTimelineCard({
  entries,
  hasMore,
  loadingMore,
  error,
  onLoadMore,
}: {
  entries: CouponRedemptionHistoryEntry[];
  hasMore: boolean;
  loadingMore: boolean;
  error: string;
  onLoadMore: () => void;
}) {
  return (
    <View className="w-full max-w-xl self-center rounded-3xl bg-white p-4 shadow-sm">
      <Text className="text-base font-semibold text-slate-900">
        Historial de canjes
      </Text>

      {entries.length === 0 ? (
        <Text className="mt-3 text-sm text-slate-500">
          Todavía nadie ha canjeado un cupón en tu tienda.
        </Text>
      ) : (
        <View className="mt-3">
          {entries.map((entry, index) => (
            <TimelineRow
              key={entry.claimId}
              entry={entry}
              last={index === entries.length - 1}
            />
          ))}
        </View>
      )}

      {error ? (
        <Text className="mt-2 text-sm text-rose-700">{error}</Text>
      ) : null}

      {hasMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
          disabled={loadingMore}
          onPress={onLoadMore}
          className="mt-3 min-h-[48px] w-full items-center justify-center rounded-full border border-slate-300 bg-white px-5"
        >
          <Text className="text-sm font-semibold text-slate-900">
            {loadingMore ? "Cargando..." : "Ver más canjes"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function TimelineRow({
  entry,
  last,
}: {
  entry: CouponRedemptionHistoryEntry;
  last: boolean;
}) {
  return (
    <View className="flex-row gap-3">
      <View className="items-center">
        <View className="h-7 w-7 items-center justify-center rounded-full bg-emerald-500">
          <MaterialCommunityIcons name="check" size={16} color="#ffffff" />
        </View>
        {/* The connector stops at the last entry, so the timeline ends. */}
        {last ? null : <View className="w-0.5 flex-1 bg-emerald-100" />}
      </View>

      <View className={`min-w-0 flex-1 ${last ? "pb-0" : "pb-4"}`}>
        <Text numberOfLines={1} className="text-sm font-semibold text-slate-900">
          {entry.couponTitle}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-xs text-slate-500">
          {`${redemptionCustomerLabel(entry.customerName)} · ${formatDateOnly(entry.redeemedOn)}`}
        </Text>
      </View>
    </View>
  );
}
