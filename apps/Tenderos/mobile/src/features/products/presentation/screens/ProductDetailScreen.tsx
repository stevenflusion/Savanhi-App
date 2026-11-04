import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { PageDots } from "@/src/components/design/PageDots";
import { RoundIconButton } from "@/src/components/design/RoundIconButton";
import { SnapCarousel } from "@/src/components/design/SnapCarousel";
import { useAuth } from "@/src/features/auth";

import type { Product } from "../../domain/product";
import { createProductsFetchRepository } from "../../infrastructure/products-fetch-repository";
import {
  ProductDetailBody,
  ProductDetailPage,
} from "../components/ProductDetailBody";

/**
 * One product, seen as the tendero's own detail screen (S14).
 *
 * Like the coupon detail it is a CAROUSEL and not a single page: the tendero
 * is walking their own shelf, so the neighbours peek and a swipe moves to the
 * next product of the same store, with the dots and everything below the
 * carousel following whichever product is centred.
 *
 * It lives outside the tabs (`app/product/[id].tsx`) because it is pushed over
 * the workspace and carries its own back button, not a sixth destination.
 *
 * There is NO quantity stepper. The reference shows one; a tendero's own
 * product has no per-screen quantity to step — the only quantity it has is its
 * STOCK, and the one endpoint that saves it is the inline editor the "Editar
 * producto" button opens, so a stepper here would either write nothing or
 * write a second, competing stock value.
 *
 * S11: the id is a route parameter and a request path segment; nothing
 * rendered comes from it and no screen here carries a timestamp.
 */
export function ProductDetailScreen({ productId }: { productId: string }) {
  const router = useRouter();
  const { requestAuthenticated } = useAuth();
  const repository = useMemo(
    () => createProductsFetchRepository(requestAuthenticated),
    [requestAuthenticated],
  );

  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(0);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
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
      setProducts([]);
      setReady(false);
      setLoading(false);
      return;
    }

    const list = await repository.listStoreProducts(storeId);
    if (!list.success) {
      setError(list.error);
      setLoading(false);
      return;
    }

    setProducts(list.data);
    // The carousel opens on the product the tendero tapped. A product that is
    // no longer in the store leaves `ready` false, which is the "not found"
    // state below rather than a silent jump to a different product.
    const index = list.data.findIndex((item) => item.id === productId);
    setPage(index >= 0 ? index : 0);
    setReady(index >= 0);
    setLoading(false);
  }, [productId, repository]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const current = ready ? products[page] : undefined;

  if (loading && !products.length) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="small" color="#111827" />
      </View>
    );
  }

  return (
    <View className="flex-1">
      <View className="w-full max-w-xl flex-row items-center justify-between gap-3 self-center px-4 py-2">
        <RoundIconButton
          icon="chevron-left"
          label="Volver"
          tone="light"
          onPress={() => router.back()}
        />
        <Text className="text-base font-semibold text-slate-900">Producto</Text>
        {/* Keeps the title centred; the action is the pill at the bottom. */}
        <View className="h-12 w-12" />
      </View>

      {error ? (
        <View className="mx-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <Text className="text-sm text-rose-700">{error}</Text>
        </View>
      ) : null}

      {!current ? (
        error ? null : (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-center text-lg font-semibold text-slate-900">
              No encontramos este producto
            </Text>
            <Text className="mt-1 text-center text-sm text-slate-500">
              Puede que ya no esté en tu tienda.
            </Text>
          </View>
        )
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 140, gap: 16 }}
          showsVerticalScrollIndicator={false}
        >
          <SnapCarousel
            testID="product-detail-carousel"
            data={products}
            initialPage={page}
            onPageChange={setPage}
            keyExtractor={(product) => product.id}
            renderItem={(product) => <ProductDetailPage product={product} />}
          />

          <PageDots count={products.length} activeIndex={page} />

          <View className="px-4">
            <ProductDetailBody product={current} />

            {/*
              The edit flow is NOT reimplemented here. The products tab already
              owns every write — price, stock, sale unit, activate, remove —
              so the button hands the tendero back to that editor, opened on
              this product, exactly as the coupon detail hands back to the
              coupon editor.
            */}
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push(`/products?intent=edit&productId=${current.id}`)
              }
              className="mt-6 min-h-[56px] w-full flex-row items-center justify-center gap-2 rounded-full bg-black px-5"
            >
              <Text className="text-base font-semibold text-white">
                Editar producto
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}
