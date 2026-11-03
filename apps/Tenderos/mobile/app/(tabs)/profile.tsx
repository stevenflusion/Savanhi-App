import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MobileTopBar } from "@/src/components/MobileTopBar";
import { useAuth } from "@/src/features/auth";
import { MAPBOX_ACCESS_TOKEN } from "@/src/lib/mapbox";

type Store = {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

type Product = {
  id: string;
  name: string;
  price: number | null;
  stock: number;
  active: boolean;
};

type MapboxPlaceFeature = {
  properties?: {
    feature_type?: string;
    name?: string;
    context?: {
      place?: { name?: string };
      country?: { name?: string };
    };
  };
};

export default function ProfileTab() {
  const { user, logout, isReady, requestAuthenticated } = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [locationLabel, setLocationLabel] = useState("");
  const [products, setProducts] = useState<Product[]>([]);

  const loadProfileDetails = useCallback(async () => {
    const storesResult = await requestAuthenticated("/api/v1/tenderos/stores/me");
    if (!storesResult.success) {
      setStore(null);
      setLocationLabel("");
      setProducts([]);
      return;
    }

    const storesPayload = (await storesResult.response.json().catch(() => ({}))) as {
      data?: Store[];
    };
    const currentStore = storesPayload.data?.[0] ?? null;
    setStore(currentStore);

    if (!currentStore) {
      setLocationLabel("");
      setProducts([]);
      return;
    }

    let shortLocation = "";
    if (currentStore.latitude !== null && currentStore.longitude !== null) {
      if (MAPBOX_ACCESS_TOKEN) {
        try {
          const url = new URL("https://api.mapbox.com/search/geocode/v6/reverse");
          url.searchParams.set("longitude", String(currentStore.longitude));
          url.searchParams.set("latitude", String(currentStore.latitude));
          url.searchParams.set("types", "neighborhood,locality,district,place,country");
          url.searchParams.set("language", "es");
          url.searchParams.set("access_token", MAPBOX_ACCESS_TOKEN);
          const response = await fetch(url.toString());
          if (response.ok) {
            const result = (await response.json()) as {
              features?: MapboxPlaceFeature[];
            };
            const features = result.features ?? [];
            const placeName =
              features.find((feature) => feature.properties?.feature_type === "place")
                ?.properties?.name ?? "";
            const countryName =
              features.find((feature) => feature.properties?.feature_type === "country")
                ?.properties?.name ?? "";
            const neighborhood = features.find((feature) => {
              const properties = feature.properties;
              return (
                ["neighborhood", "locality", "district"].includes(
                  properties?.feature_type ?? "",
                ) &&
                Boolean(properties?.name) &&
                !/^distrito metropolitano/i.test(properties?.name ?? "")
              );
            })?.properties?.name;
            shortLocation = neighborhood && placeName
              ? `${placeName}, ${neighborhood}`
              : placeName && countryName
                ? `${placeName}, ${countryName}`
                : placeName || countryName;
          }
        } catch {
          shortLocation = "";
        }
      }

      if (!shortLocation) {
        try {
          const [address] = await Location.reverseGeocodeAsync({
            latitude: currentStore.latitude,
            longitude: currentStore.longitude,
          });
          const city = address?.city;
          const country = address?.country;
          const region = address?.region;
          const neighborhood = [address?.subregion, address?.district].find(
            (place) =>
              place &&
              place !== city &&
              place !== country &&
              place !== region &&
              !/distrito metropolitano/i.test(place),
          );
          shortLocation =
            city && neighborhood
              ? `${city}, ${neighborhood}`
              : city && country
                ? `${city}, ${country}`
                : city || country || "";
        } catch {
          shortLocation = "";
        }
      }
    }
    if (!shortLocation && currentStore.address) {
      shortLocation = currentStore.address
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(-2)
        .join(", ");
    }
    setLocationLabel(shortLocation);

    const [productsResult, catalogResult] = await Promise.all([
      requestAuthenticated(`/api/v1/tenderos/stores/${currentStore.id}/products`),
      requestAuthenticated(`/api/v1/tenderos/stores/${currentStore.id}/catalog`),
    ]);
    const [productsPayload, catalogPayload] = await Promise.all([
      productsResult.success
        ? productsResult.response.json().catch(() => ({}))
        : Promise.resolve({}),
      catalogResult.success
        ? catalogResult.response.json().catch(() => ({}))
        : Promise.resolve({}),
    ]) as [{ data?: Array<Omit<Product, "name"> & { name: string }> }, {
      data?: Array<{
        id: string;
        price: number | null;
        stock: number;
        active: boolean;
        product: { commercialName: string };
      }>;
    }];
    const privateProducts = productsPayload.data ?? [];
    const catalogProducts = (catalogPayload.data ?? []).map((item) => ({
      id: item.id,
      name: item.product.commercialName,
      price: item.price,
      stock: item.stock,
      active: item.active,
    }));
    setProducts([...privateProducts, ...catalogProducts]);
  }, [requestAuthenticated]);

  useFocusEffect(
    useCallback(() => {
      if (isReady) void loadProfileDetails();
    }, [isReady, loadProfileDetails]),
  );

  if (!isReady) return null;

  const fullName = user?.fullName?.trim() || "Tu cuenta";
  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const activeProducts = products.filter((product) => product.active);

  return (
    <SafeAreaView className="flex-1 bg-[#fafafa]">
      <MobileTopBar title="Perfil" subtitle="Tu negocio, de un vistazo" />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center pb-8">
          <View className="h-24 w-24 items-center justify-center rounded-full bg-black">
            <Text className="text-3xl font-medium text-[#fef7ee]">
              {initials || "S"}
            </Text>
          </View>
          <Text className="mt-5 text-center text-3xl font-semibold tracking-tight text-black">
            {store?.name ?? fullName}
          </Text>
          {store?.name ? (
            <Text className="mt-1 text-base text-gray-500">{fullName}</Text>
          ) : null}
          {locationLabel ? (
            <View className="mt-4 max-w-full flex-row items-center rounded-full bg-[#fef7ee] px-4 py-2">
              <Ionicons name="location" size={16} color="#0b0b0b" />
              <Text className="ml-2 flex-shrink text-sm text-[#0b0b0b]">
                {locationLabel}
              </Text>
            </View>
          ) : (
            <Text className="mt-3 text-sm text-gray-500">Agrega la ubicación de tu tienda</Text>
          )}
        </View>

        <View className="flex-row border-y border-[#e5e5e5] py-5">
          <View className="flex-1 items-center border-r border-[#e5e5e5]">
            <Text className="text-2xl font-semibold text-black">{activeProducts.length}</Text>
            <Text className="mt-1 text-sm text-gray-500">Productos</Text>
          </View>
          <View className="flex-1 items-center">
            <View className="flex-row items-center">
              {Array.from({ length: 5 }, (_, index) => (
                <Ionicons
                  key={index}
                  name="star-outline"
                  size={16}
                  color="#0b0b0b"
                  style={{ marginHorizontal: 1 }}
                />
              ))}
            </View>
            <Text className="mt-2 text-sm text-gray-500">Sin calificaciones</Text>
          </View>
        </View>

        <View className="pt-8">
          <Text className="text-xl font-semibold tracking-tight text-black">
            En tu catálogo
          </Text>
          {activeProducts.length ? (
            activeProducts.slice(0, 4).map((product, index) => (
              <View
                key={product.id}
                className={`flex-row items-center justify-between py-4 ${index < Math.min(activeProducts.length, 4) - 1 ? "border-b border-[#e5e5e5]" : ""}`}
              >
                <View className="mr-4 flex-1">
                  <Text className="text-base font-medium text-black" numberOfLines={1}>
                    {product.name}
                  </Text>
                  <Text className="mt-1 text-sm text-gray-500">
                    {product.stock > 0 ? "Disponible" : "Agotado"}
                  </Text>
                </View>
                {product.price !== null ? (
                  <Text className="text-base font-medium text-black">
                    ${Number(product.price).toFixed(2)}
                  </Text>
                ) : null}
              </View>
            ))
          ) : (
            <Text className="py-4 text-base text-gray-500">
              Tus productos aparecerán aquí cuando los agregues.
            </Text>
          )}
        </View>

        <View className="mt-8 border-t border-[#e5e5e5] pt-6">
          <Text className="text-xl font-semibold tracking-tight text-black">
            Tu cuenta
          </Text>
          <View className="mt-4 flex-row items-center py-3">
            <Ionicons name="person-outline" size={20} color="#0b0b0b" />
            <Text className="ml-4 flex-1 text-base text-black">{fullName}</Text>
          </View>
          <View className="flex-row items-center border-t border-[#e5e5e5] py-4">
            <Ionicons name="mail-outline" size={20} color="#0b0b0b" />
            <Text className="ml-4 flex-1 text-base text-black">{user?.email ?? "-"}</Text>
          </View>
          <Pressable
            onPress={logout}
            accessibilityRole="button"
            className="mt-5 h-14 items-center justify-center rounded-full bg-black"
          >
            <Text className="text-base font-semibold text-white">Cerrar sesión</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
