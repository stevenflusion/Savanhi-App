import type {
  Coupon,
  CouponRedemptionHistoryEntry,
  StoreMetrics,
} from "@repo/api-contracts";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { DashboardStatCard } from "@/src/components/DashboardStatCard";
import { EmptyState } from "@/src/components/EmptyState";
import { useAuth } from "@/src/features/auth";
import { todayDateOnly } from "@/src/lib/date-only";
import { resolveStoreLocationLabel } from "@/src/lib/store-location";

import { selectActiveCoupons } from "../../domain/coupon-status";
import {
  REDEMPTION_HISTORY_PAGE_SIZE,
  STORE_METRICS_RECENT_REDEMPTIONS,
  createStoreMetricsFetchRepository,
} from "../../infrastructure/store-metrics-fetch-repository";
import { ActiveCouponsCarousel } from "../components/ActiveCouponsCarousel";
import { CouponFunnelCard } from "../components/CouponFunnelCard";
import { HomeHeader } from "../components/HomeHeader";
import { HomeHeadline } from "../components/HomeHeadline";
import { HomeQuickActions } from "../components/HomeQuickActions";
import { RedemptionTimelineCard } from "../components/RedemptionTimelineCard";

/** Where the round black button and the grid's shortcuts go. */
const NEW_COUPON_ROUTE = "/coupons?intent=new";

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
  const [storeName, setStoreName] = useState("");
  const [storePhotoUrl, setStorePhotoUrl] = useState<string | null>(null);
  const [locationLabel, setLocationLabel] = useState("");
  const [storeMissing, setStoreMissing] = useState(false);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
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

    const store = stores.data[0] ?? null;
    const nextStoreId = store?.id ?? "";
    setStoreId(nextStoreId);
    setStoreName(store?.name ?? "");
    // The first photo is the store's face: `store_photos.position` is the
    // tendero's own order and the backend returns them in it (T2).
    setStorePhotoUrl(store?.photos?.[0]?.url ?? null);
    setStoreMissing(!nextStoreId);
    if (!nextStoreId) {
      setCoupons([]);
      setMetrics(null);
      setRedemptions([]);
      setHasMore(false);
      setLocationLabel("");
      setLoading(false);
      return;
    }

    // The location is resolved beside the reads and never blocks them: a slow
    // or failing geocoder must not keep the numbers off the screen.
    void resolveStoreLocationLabel(store).then(setLocationLabel);

    // The metrics are still ONE request for the whole funnel, the totals and
    // the history preview (T7). The coupon list is the SECOND read the
    // carousel needs and the summary deliberately does not carry: a card has
    // to know the photo, the categories, the paused flag and the validity end
    // date to decide whether a coupon is active and what to draw.
    const [result, couponList] = await Promise.all([
      repository.readStoreMetrics(nextStoreId),
      repository.listStoreCoupons(nextStoreId),
    ]);
    if (!result.success) {
      setError(result.error);
      setCoupons([]);
      setMetrics(null);
      setRedemptions([]);
      setHasMore(false);
      setLoading(false);
      return;
    }

    setCoupons(couponList.success ? couponList.data : []);
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
  const activeCoupons = selectActiveCoupons(coupons, todayDateOnly());
  const openCoupon = (coupon: Coupon) => router.push(`/coupon/${coupon.id}`);
  const createCoupon = () => router.push(NEW_COUPON_ROUTE);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingBottom: 120,
        gap: 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      {!loading && !storeMissing ? (
        <>
          <HomeHeader
            storeName={storeName}
            photoUrl={storePhotoUrl}
            locationLabel={locationLabel}
          />
          <HomeHeadline
            activeCount={activeCoupons.length}
            onCreate={createCoupon}
          />
        </>
      ) : null}

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
        the metrics are loading or failing. "Nuevo cupón" is NOT among them:
        the round black button above is that action, and the slot went to a
        real second target instead of a duplicate.
      */}
      {!loading ? (
        <HomeQuickActions
          actions={[
            {
              id: "scan",
              label: "Escanear cupón",
              icon: "line-scan",
              onPress: () => router.push("/scanner"),
            },
            {
              id: "coupons",
              label: "Mis cupones",
              icon: "ticket-outline",
              onPress: () => router.push("/coupons"),
            },
            {
              id: "inventory",
              label: "Revisar inventario",
              icon: "cube-outline",
              onPress: () => router.push("/products"),
            },
            {
              id: "add-product",
              label: "Agregar producto",
              icon: "plus-box-outline",
              onPress: () => router.push("/products?intent=add"),
            },
          ]}
        />
      ) : null}

      {!loading && !error && !storeMissing ? (
        <ActiveCouponsCarousel
          coupons={activeCoupons}
          onOpen={openCoupon}
          onCreate={createCoupon}
        />
      ) : null}

      {!loading && !error && metrics ? (
        <>
          {hasCoupons ? (
            <CouponFunnelCard coupons={metrics.coupons} />
          ) : (
            /*
              No "Crear cupón" button here any more: the carousel above is
              already showing its own invite in exactly this state, and two
              black pills for one action in one screenful is noise.
            */
            <EmptyState
              title="Sin cupones aún"
              message="Crea tu primer cupón para empezar a medir reclamos y canjes."
            />
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
