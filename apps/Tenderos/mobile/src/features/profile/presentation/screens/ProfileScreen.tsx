import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useAuth } from "@/src/features/auth";
import type { ProductStore } from "@/src/features/products/application/ports/products-repository";
import {
  productPriceLabel,
  productStockLabel,
  type Product,
} from "@/src/features/products/domain/product";
import {
  productCategoryColor,
  productCategoryIcon,
} from "@/src/features/products/domain/product-category";
import { createProductsFetchRepository } from "@/src/features/products/infrastructure/products-fetch-repository";
import { resolveStoreLocationLabel } from "@/src/lib/store-location";

import { ProfileHeader } from "../components/ProfileHeader";

/** How many catalog rows the profile previews before the Productos tab. */
const CATALOG_PREVIEW = 4;

/**
 * The tendero's own profile, in the same card language as the Home tab and
 * the coupons (S14): the store's photo and name on a soft background, then
 * white cards with a large radius for the facts and the actions.
 *
 * Two things here are reuse and not restyling, and they are the point of this
 * unit:
 *
 * 1. The location comes from `resolveStoreLocationLabel`, the ONE geocoding
 *    path in the app. This screen used to carry its own inline copy of the
 *    Mapbox-then-device-then-address chain, so the Home header and the Perfil
 *    tab could word the same coordinates differently.
 * 2. The store and its catalog come from the products repository the
 *    workspace and the product detail read through, so a price or a stock
 *    cannot say one thing here and another one tab away.
 *
 * S11: no id and no clock time. The catalog rows carry real ids as list keys
 * and the market-reference timestamps are never read here at all.
 */
export function ProfileScreen() {
  const { user, logout, isReady, requestAuthenticated } = useAuth();
  const repository = useMemo(
    () => createProductsFetchRepository(requestAuthenticated),
    [requestAuthenticated],
  );

  const [store, setStore] = useState<ProductStore | null>(null);
  const [locationLabel, setLocationLabel] = useState("");
  const [products, setProducts] = useState<Product[]>([]);

  const load = useCallback(async () => {
    const stores = await repository.listOwnStores();
    if (!stores.success) {
      setStore(null);
      setLocationLabel("");
      setProducts([]);
      return;
    }

    const currentStore = stores.data[0] ?? null;
    setStore(currentStore);
    if (!currentStore) {
      setLocationLabel("");
      setProducts([]);
      return;
    }

    // Resolved beside the catalog read and never in front of it: a slow or
    // failing geocoder must not keep the tendero's own products off screen.
    void resolveStoreLocationLabel(currentStore).then(setLocationLabel);

    const list = await repository.listStoreProducts(currentStore.id);
    setProducts(list.success ? list.data : []);
  }, [repository]);

  useFocusEffect(
    useCallback(() => {
      if (isReady) void load();
    }, [isReady, load]),
  );

  if (!isReady) return null;

  const fullName = user?.fullName?.trim() || "Tu cuenta";
  const activeProducts = products.filter((product) => product.active);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 140,
        gap: 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      <ProfileHeader
        title={store?.name ?? fullName}
        subtitle={store?.name ? fullName : ""}
        photoUrl={store?.photos?.[0]?.url ?? null}
        locationLabel={locationLabel}
      />

      <View className="w-full max-w-xl flex-row self-center rounded-3xl bg-white py-5 shadow-sm">
        <View className="flex-1 items-center border-r border-slate-100">
          <Text className="text-2xl font-semibold text-slate-900">
            {activeProducts.length}
          </Text>
          <Text className="mt-1 text-sm text-slate-500">Productos</Text>
        </View>
        {/*
          There are no ratings in this product: no table, no endpoint, no
          field. The line stays as the neutral fact it is and the five empty
          stars are GONE — a star row is a rating widget, and drawing one for
          data that does not exist promises a feature the app does not have.
        */}
        <View className="flex-1 items-center">
          <MaterialCommunityIcons
            name="star-outline"
            size={22}
            color="#94a3b8"
          />
          <Text className="mt-1 text-sm text-slate-500">Sin calificaciones</Text>
        </View>
      </View>

      <View className="w-full max-w-xl self-center rounded-3xl bg-white p-4 shadow-sm">
        <Text className="text-xl font-semibold tracking-tight text-slate-900">
          En tu catálogo
        </Text>

        {activeProducts.length ? (
          <View className="mt-3 gap-3">
            {activeProducts.slice(0, CATALOG_PREVIEW).map((product) => (
              <CatalogRow key={product.id} product={product} />
            ))}
          </View>
        ) : (
          <Text className="mt-3 text-base text-slate-500">
            Tus productos aparecerán aquí cuando los agregues.
          </Text>
        )}
      </View>

      <View className="w-full max-w-xl self-center rounded-3xl bg-white p-4 shadow-sm">
        <Text className="text-xl font-semibold tracking-tight text-slate-900">
          Tu cuenta
        </Text>

        <View className="mt-3 flex-row items-center gap-3">
          <MaterialCommunityIcons
            name="email-outline"
            size={20}
            color="#1f2937"
          />
          <Text numberOfLines={1} className="flex-1 text-base text-slate-900">
            {user?.email ?? "-"}
          </Text>
        </View>

        <Pressable
          onPress={logout}
          accessibilityRole="button"
          className="mt-5 min-h-[56px] items-center justify-center rounded-full bg-black px-5"
        >
          <Text className="text-base font-semibold text-white">
            Cerrar sesión
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** One catalog preview row, on the same pastel tile the product screens use. */
function CatalogRow({ product }: { product: Product }) {
  const colour = productCategoryColor(product.categoryKey);

  return (
    <View className="flex-row items-center gap-3">
      <View
        style={{ backgroundColor: colour.surface }}
        className="h-12 w-12 items-center justify-center rounded-2xl"
      >
        <MaterialCommunityIcons
          name={productCategoryIcon(product.categoryKey)}
          size={22}
          color={colour.ink}
        />
      </View>

      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={1}
          className="text-base font-medium text-slate-900"
        >
          {product.name}
        </Text>
        <Text className="mt-0.5 text-sm text-slate-500">
          {productStockLabel(product.stock)}
        </Text>
      </View>

      <Text className="text-base font-semibold text-slate-900">
        {productPriceLabel(product.price)}
      </Text>
    </View>
  );
}
