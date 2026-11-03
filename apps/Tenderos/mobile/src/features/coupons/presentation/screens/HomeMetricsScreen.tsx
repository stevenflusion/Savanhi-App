import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type {
  CouponRedemptionHistoryEntry,
  StoreMetrics,
} from "@repo/api-contracts";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { DashboardStatCard } from "@/src/components/DashboardStatCard";
import { EmptyState } from "@/src/components/EmptyState";
import { QuickActionsCard } from "@/src/components/QuickActionsCard";
import { useAuth } from "@/src/features/auth";

import {
  REDEMPTION_HISTORY_PAGE_SIZE,
  STORE_METRICS_RECENT_REDEMPTIONS,
  createStoreMetricsFetchRepository,
} from "../../infrastructure/store-metrics-fetch-repository";
import { CouponFunnelCard } from "../components/CouponFunnelCard";
import { RedemptionTimelineCard } from "../components/RedemptionTimelineCard";

/**
 * The tendero's home tab: what their coupons are actually doing (S9).
 *
 * The whole screen is ONE request. `GET /stores/:storeId/metrics` already
 * carries the follower count, the store-wide totals, the per-coupon funnel and
 * the newest redemptions, so the tab never assembles four reads that could
 * disagree with each other. The dedicated redemptions route is called only
 * when the tendero asks for more history than that preview carried.
 *
 * It refreshes on FOCUS, which is the point: the tendero scans a QR on the
 * scanner screen and comes straight back here, and the canje they just made
 * has to be on the timeline.
 *
 * S11: no id and no clock time reaches the screen. The coupon and claim ids
 * are list keys and request path segments, the metrics carry no timestamp at
 * all, and every redemption date goes through the shared date-only helper.
 */
export function HomeMetricsScreen() {
  const router = useRouter();
  const { requestAuthenticated } = useAuth();
  const repository = useMemo(
    () => createStoreMetricsFetchRepository(requestAuthenticated),
    [requestAuthenticated],
  );

  const [storeId, setStoreId] = useState("");
  const [storeMissing, setStoreMissing] = useState(false);
  const [metrics, setMetrics] = useState<StoreMetrics | null>(null);
  const [redemptions, setRedemptions] = useState<
    CouponRedemptionHistoryEntry[]
  >([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setHistoryError("");

    const stores = await repository.listOwnStores();
    if (!stores.success) {
      setError(stores.error);
      setLoading(false);
      return;
    }

    const nextStoreId = stores.data[0]?.id ?? "";
    setStoreId(nextStoreId);
    setStoreMissing(!nextStoreId);
    if (!nextStoreId) {
      setMetrics(null);
      setRedemptions([]);
      setHasMore(false);
      setLoading(false);
      return;
    }

    const result = await repository.readStoreMetrics(nextStoreId);
    if (!result.success) {
      setError(result.error);
      setMetrics(null);
      setRedemptions([]);
      setHasMore(false);
      setLoading(false);
      return;
    }

    setMetrics(result.data);
    // The history restarts from the summary's own preview on every focus, so
    // a redemption made elsewhere lands at the top instead of behind pages
    // the screen had already loaded.
    setRedemptions(result.data.recentRedemptions);
    // A FULL preview is the only state that can have more behind it: the
    // summary carries at most that many, so a shorter one is the whole
    // history.
    setHasMore(
      result.data.recentRedemptions.length >= STORE_METRICS_RECENT_REDEMPTIONS,
    );
    setLoading(false);
  }, [repository]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loadMore = async () => {
    if (!storeId || loadingMore) return;
    setLoadingMore(true);
    setHistoryError("");

    const page = await repository.readRedemptionHistory(storeId, {
      limit: REDEMPTION_HISTORY_PAGE_SIZE,
      offset: redemptions.length,
    });
    setLoadingMore(false);
    if (!page.success) {
      setHistoryError(page.error);
      return;
    }

    setRedemptions((current) => mergeRedemptions(current, page.data.entries));
    setHasMore(page.data.nextOffset !== null);
  };

  const hasCoupons = (metrics?.coupons.length ?? 0) > 0;

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingBottom: 120,
        gap: 12,
      }}
      showsVerticalScrollIndicator={false}
    >
      {loading ? (
        <Text className="py-6 text-center text-sm text-slate-500">
          Cargando tu tienda...
        </Text>
      ) : null}

      {error ? (
        <View className="w-full max-w-xl self-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <Text className="text-sm text-rose-700">{error}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            className="mt-2"
          >
            <Text className="text-sm font-semibold text-rose-800">
              Reintentar
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && storeMissing ? (
        <EmptyState
          title="Sin tienda disponible"
          message="Completa el registro de tu tienda para ver tus cupones."
        />
      ) : null}

      {!loading && !error && metrics ? (
        <>
          <View className="w-full max-w-xl self-center flex-row flex-wrap gap-2">
            <DashboardStatCard
              title="Reclamados"
              value={String(metrics.totals.claimedCount)}
              subtitle={`En ${metrics.totals.couponCount} cupones`}
              icon="RCL"
              tone="blue"
            />
            <DashboardStatCard
              title="Canjeados"
              value={String(metrics.totals.redeemedCount)}
              subtitle="Cupones usados en tu tienda"
              icon="CNJ"
              tone="green"
            />
          </View>

          <View className="w-full max-w-xl self-center flex-row flex-wrap gap-2">
            <DashboardStatCard
              title="Seguidores"
              value={String(metrics.followersCount)}
              subtitle="Clientes que siguen tu tienda"
              icon="SEG"
              tone="violet"
            />
            <DashboardStatCard
              title="Disponibles"
              value={String(metrics.totals.remainingStock)}
              subtitle="Cupones por reclamar"
              icon="DSP"
              tone="amber"
            />
          </View>
        </>
      ) : null}

      {/*
        The shortcuts are navigation, not data, so they stay reachable while
        the metrics are loading or failing — and they keep the targets they
        already had, which all still exist in the Productos tab.
      */}
      {!loading ? (
        <QuickActionsCard
          actions={[
            {
              id: "coupon",
              label: "Nuevo cupón",
              icon: "CPN",
              onPress: () => router.push("/coupons"),
            },
            {
              id: "scan",
              label: "Escanear cupón",
              icon: "QR",
              onPress: () => router.push("/scanner"),
            },
            {
              id: "inventory",
              label: "Revisar inventario",
              icon: "STK",
              onPress: () => router.push("/products"),
            },
          ]}
        />
      ) : null}

      {!loading && !error && metrics ? (
        <>
          {hasCoupons ? (
            <CouponFunnelCard coupons={metrics.coupons} />
          ) : (
            <View className="w-full max-w-xl self-center gap-3">
              <EmptyState
                title="Sin cupones aún"
                message="Crea tu primer cupón para empezar a medir reclamos y canjes."
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/coupons")}
                className="min-h-[52px] w-full flex-row items-center justify-center gap-2 rounded-full bg-black px-5"
              >
                <MaterialCommunityIcons
                  name="plus"
                  size={20}
                  color="#ffffff"
                />
                <Text className="text-base font-semibold text-white">
                  Crear cupón
                </Text>
              </Pressable>
            </View>
          )}

          <RedemptionTimelineCard
            entries={redemptions}
            hasMore={hasMore}
            loadingMore={loadingMore}
            error={historyError}
            onLoadMore={() => void loadMore()}
          />
        </>
      ) : null}
    </ScrollView>
  );
}

/**
 * Appends a page without ever showing an entry twice.
 *
 * The offset is the number of entries already on screen, so a redemption that
 * lands between the summary read and the "load more" shifts the window by one
 * and would otherwise repeat the last entry. Claim ids are unique, which makes
 * the de-duplication exact rather than a heuristic.
 */
function mergeRedemptions(
  current: CouponRedemptionHistoryEntry[],
  incoming: CouponRedemptionHistoryEntry[],
): CouponRedemptionHistoryEntry[] {
  const seen = new Set(current.map((entry) => entry.claimId));
  return [
    ...current,
    ...incoming.filter((entry) => !seen.has(entry.claimId)),
  ];
}
