import type { Coupon } from "@repo/api-contracts";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { PageDots } from "@/src/components/design/PageDots";
import { RoundIconButton } from "@/src/components/design/RoundIconButton";
import { SnapCarousel } from "@/src/components/design/SnapCarousel";
import { useAuth } from "@/src/features/auth";
import { todayDateOnly } from "@/src/lib/date-only";

import { isCouponExpired } from "../../domain/coupon-status";
import { createStoreMetricsFetchRepository } from "../../infrastructure/store-metrics-fetch-repository";
import {
  CouponDetailBody,
  CouponDetailPage,
} from "../components/CouponDetailBody";

/**
 * One coupon, seen as the tendero's own detail screen (S14).
 *
 * It is a CAROUSEL and not a single page, which is the one structural decision
 * here: the tendero is comparing their own promotions, so the neighbours peek
 * and a swipe moves to the next coupon of the same store. Everything below the
 * carousel follows whichever coupon is centred, so the screen is never showing
 * one coupon's photo over another's numbers.
 *
 * It lives outside the tabs (`app/coupon/[id].tsx`) because it is a detail
 * pushed over the workspace, not a fifth destination.
 *
 * S11: the id is a route parameter and a request path segment, and nothing
 * rendered comes from it; every date goes through the shared date-only helper.
 */
export function CouponDetailScreen({ couponId }: { couponId: string }) {
  const router = useRouter();
  const { requestAuthenticated } = useAuth();
  const repository = useMemo(
    () => createStoreMetricsFetchRepository(requestAuthenticated),
    [requestAuthenticated],
  );

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [redeemedByCoupon, setRedeemedByCoupon] = useState<
    Record<string, number>
  >({});
  const [page, setPage] = useState(0);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const stores = await repository.listOwnStores();
    if (!stores.success) {
      setError(stores.error);
      setLoading(false);
      return;
    }

    const storeId = stores.data[0]?.id ?? "";
    if (!storeId) {
      setCoupons([]);
      setReady(true);
      setLoading(false);
      return;
    }

    const [list, metrics] = await Promise.all([
      repository.listStoreCoupons(storeId),
      // The redeemed count is the ONE number `Coupon` does not carry (T7 kept
      // it on the metrics payload). A failed read leaves it absent rather than
      // showing a zero nobody earned.
      repository.readStoreMetrics(storeId),
    ]);
    if (!list.success) {
      setError(list.error);
      setLoading(false);
      return;
    }

    setCoupons(list.data);
    setRedeemedByCoupon(
      metrics.success
        ? Object.fromEntries(
            metrics.data.coupons.map((item) => [
              item.couponId,
              item.redeemedCount,
            ]),
          )
        : {},
    );
    // The carousel opens on the coupon the tendero tapped. A coupon that is
    // not in the list leaves `ready` true with no page, which is the "not
    // found" state below.
    const index = list.data.findIndex((item) => item.id === couponId);
    setPage(index >= 0 ? index : 0);
    setReady(index >= 0);
    setLoading(false);
  }, [couponId, repository]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const current = ready ? coupons[page] : undefined;

  /**
   * Pause and activate replace the ONE coupon in place instead of reloading
   * the list: a reload would rebuild the carousel and throw the tendero back
   * to the coupon the route opened on, losing the one they had swiped to.
   */
  const togglePaused = async () => {
    if (!current) return;
    setBusy(true);
    setError("");
    const result = await repository.setCouponPaused(current.id, !current.paused);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setCoupons((list) =>
      list.map((item) => (item.id === result.data.id ? result.data : item)),
    );
  };

  if (loading && !coupons.length) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="small" color="#111827" />
      </View>
    );
  }

  const expired = current ? isCouponExpired(current, todayDateOnly()) : false;

  return (
    <View className="flex-1">
      <View className="w-full max-w-xl flex-row items-center justify-between gap-3 self-center px-4 py-2">
        <RoundIconButton
          icon="chevron-left"
          label="Volver"
          tone="light"
          onPress={() => router.back()}
        />
        <Text className="text-base font-semibold text-slate-900">Cupón</Text>
        {current ? (
          <RoundIconButton
            icon="pencil-outline"
            label="Editar cupón"
            tone="light"
            onPress={() =>
              router.push(`/coupons?intent=edit&couponId=${current.id}`)
            }
          />
        ) : (
          // Keeps the title centred when there is nothing to edit.
          <View className="h-12 w-12" />
        )}
      </View>

      {!current ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-lg font-semibold text-slate-900">
            No encontramos este cupón
          </Text>
          <Text className="mt-1 text-center text-sm text-slate-500">
            Puede que ya no esté en tu tienda.
          </Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 140, gap: 16 }}
          showsVerticalScrollIndicator={false}
        >
          <SnapCarousel
            testID="coupon-detail-carousel"
            data={coupons}
            initialPage={page}
            onPageChange={setPage}
            keyExtractor={(coupon) => coupon.id}
            renderItem={(coupon) => <CouponDetailPage coupon={coupon} />}
          />

          <PageDots count={coupons.length} activeIndex={page} />

          <View className="px-4">
            <CouponDetailBody
              coupon={current}
              redeemedCount={redeemedByCoupon[current.id] ?? null}
            />

            {error ? (
              <View className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                <Text className="text-sm text-rose-700">{error}</Text>
              </View>
            ) : null}

            {expired ? (
              /*
                An expired coupon has no action, and that is the rule and not a
                missing button: S6 makes the validity end date the hard limit,
                so neither pausing nor activating changes anything about it.
              */
              <View className="mt-4 self-center rounded-full bg-slate-200 px-4 py-2">
                <Text className="text-sm font-semibold text-slate-700">
                  Vencido
                </Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void togglePaused()}
                className="mt-4 min-h-[56px] w-full flex-row items-center justify-center gap-2 rounded-full bg-black px-5"
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : null}
                <Text className="text-base font-semibold text-white">
                  {current.paused ? "Activar" : "Pausar"}
                </Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
