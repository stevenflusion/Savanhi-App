import type {
  CatalogProduct,
  CatalogStoreProduct,
} from "@repo/api-contracts/catalog";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useAuth } from "../features/auth";
import { AlertCard } from "./AlertCard";
import { EmptyState } from "./EmptyState";
import { FilterTabs } from "./FilterTabs";
import { ProductCard, type Product } from "./ProductCard";
import { SearchBar } from "./SearchBar";
import { InventorySummaryCard } from "./InventorySummaryCard";

type Tool = "add" | "sale" | "inventory";
type Store = { id: string; name?: string };

function productLabel(product: CatalogProduct) {
  return [
    product.presentation,
    product.netContent && product.netContentUnit
      ? `${product.netContent} ${product.netContentUnit}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function toProduct(item: CatalogStoreProduct): Product {
  const observedPrice =
    item.product.observedPrices
      .filter(
        (price) =>
          price.amount !== null &&
          price.source.toLowerCase().startsWith("supermaxi"),
      )
      .sort(
        (left, right) =>
          new Date(right.observedAt).getTime() -
          new Date(left.observedAt).getTime(),
      )[0] ?? null;

  return {
    id: item.id,
    name: item.product.commercialName,
    category: item.product.categoryName,
    brand: item.product.brandName,
    presentation: productLabel(item.product),
    price: item.price,
    observedPrice,
    stock: item.stock,
    active: item.active,
  };
}

export function ProductsWorkspace() {
  const { requestAuthenticated } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [globalProducts, setGlobalProducts] = useState<CatalogProduct[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [tool, setTool] = useState<Tool>("add");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [saleQty, setSaleQty] = useState("1");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const requestJson = useCallback(
    async (path: string, init?: RequestInit) => {
      const result = await requestAuthenticated(path, init);
      if (!result.success) throw new Error(result.error);
      const data = await result.response.json().catch(() => ({}));
      return data as { data?: unknown };
    },
    [requestAuthenticated],
  );

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [storesResponse, globalResponse] = await Promise.all([
        requestJson("/api/v1/tenderos/stores/me"),
        requestJson("/api/v1/tenderos/catalog"),
      ]);
      const nextStores = (storesResponse.data ?? []) as Store[];
      const nextStoreId = nextStores[0]?.id ?? "";
      setStores(nextStores);
      setStoreId(nextStoreId);
      setGlobalProducts((globalResponse.data ?? []) as CatalogProduct[]);
      if (!nextStoreId) {
        setProducts([]);
        return;
      }
      const storeResponse = await requestJson(
        `/api/v1/tenderos/stores/${nextStoreId}/catalog`,
      );
      setProducts(
        ((storeResponse.data ?? []) as CatalogStoreProduct[]).map(toProduct),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo cargar el catálogo.",
      );
    } finally {
      setLoading(false);
    }
  }, [requestJson]);

  useFocusEffect(
    useCallback(() => {
      void loadCatalog();
    }, [loadCatalog]),
  );

  const categories = useMemo(
    () => ["Todas", ...Array.from(new Set(products.map((p) => p.category)))],
    [products],
  );
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (categoryFilter === "Todas" || p.category === categoryFilter) &&
        (!query ||
          `${p.name} ${p.brand} ${p.category} ${p.presentation}`
            .toLowerCase()
            .includes(query)),
    );
  }, [products, search, categoryFilter]);
  const grouped = useMemo(
    () =>
      filteredProducts.reduce<Record<string, Product[]>>((acc, product) => {
        (acc[product.category] ??= []).push(product);
        return acc;
      }, {}),
    [filteredProducts],
  );
  const summary = useMemo(
    () => ({
      total: products.length,
      inStock: products.filter((p) => p.stock > 5).length,
      lowStock: products.filter((p) => p.stock > 0 && p.stock <= 5).length,
      outOfStock: products.filter((p) => p.stock === 0).length,
      expiringSoon: 0,
      expired: 0,
    }),
    [products],
  );

  const addProduct = async (productId: string) => {
    if (!storeId)
      return setFeedback(
        "No hay una tienda disponible para agregar productos.",
      );
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/v1/tenderos/stores/${storeId}/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      setSelectedProductId("");
      setFeedback("Producto agregado con stock inicial de 1.");
      await loadCatalog();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo agregar el producto.",
      );
    } finally {
      setSaving(false);
    }
  };

  const updateProduct = async (
    id: string,
    changes: { price?: number | null; stock?: number; active?: boolean },
  ) => {
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/v1/tenderos/store-catalog-products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      setFeedback("Catálogo actualizado.");
      await loadCatalog();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo actualizar el producto.",
      );
    } finally {
      setSaving(false);
    }
  };

  const removeProduct = async (id: string) => {
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/v1/tenderos/store-catalog-products/${id}`, {
        method: "DELETE",
      });
      setFeedback("Producto quitado del catálogo.");
      await loadCatalog();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo quitar el producto.",
      );
    } finally {
      setSaving(false);
    }
  };

  const registerSale = async () => {
    const quantity = Number(saleQty);
    const product = products.find((item) => item.id === selectedProductId);
    if (
      !product ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      product.stock < quantity
    ) {
      setFeedback("Selecciona un producto y una cantidad disponible.");
      return;
    }
    await updateProduct(product.id, { stock: product.stock - quantity });
    setFeedback("Venta registrada correctamente.");
  };

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingBottom: 24,
        gap: 12,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View className="w-full max-w-xl self-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <Text className="text-base font-semibold text-slate-900">
          Acciones de productos
        </Text>
        <View className="mt-3 flex-row flex-wrap gap-2">
          {[
            { id: "add", label: "Agregar producto", value: "add" as Tool },
            { id: "sale", label: "Registrar venta", value: "sale" as Tool },
            {
              id: "inv",
              label: "Revisar inventario",
              value: "inventory" as Tool,
            },
          ].map((action) => (
            <Pressable
              key={action.id}
              onPress={() => setTool(action.value)}
              className={`min-h-[44px] min-w-[31%] flex-1 items-center justify-center rounded-xl border px-2 py-2 ${tool === action.value ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
            >
              <Text
                className={`text-xs font-semibold ${tool === action.value ? "text-emerald-800" : "text-slate-700"}`}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {tool === "add" ? (
        <View className="w-full max-w-xl self-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <Text className="text-base font-semibold text-slate-900">
            Elegir del catálogo global
          </Text>
          <Text className="mt-1 text-sm text-slate-600">
            Selecciona un producto existente. Se agregará con stock inicial de
            1.
          </Text>
          <View className="mt-3 gap-2">
            {globalProducts.map((product) => (
              <Pressable
                key={product.id}
                onPress={() => setSelectedProductId(product.id)}
                className={`rounded-xl border px-3 py-3 ${selectedProductId === product.id ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
              >
                <Text className="text-sm font-semibold text-slate-800">
                  {product.commercialName}
                </Text>
                <Text className="mt-1 text-xs text-slate-500">
                  Marca: {product.brandName} · Categoría: {product.categoryName}{" "}
                  · {productLabel(product) || "Presentación no especificada"}
                </Text>
              </Pressable>
            ))}
            {!globalProducts.length ? (
              <EmptyState
                title="Catálogo global vacío"
                message="No hay productos disponibles para agregar."
              />
            ) : null}
          </View>
          <Pressable
            disabled={!selectedProductId || saving}
            onPress={() => void addProduct(selectedProductId)}
            className="mt-3 min-h-[44px] items-center justify-center rounded-xl bg-emerald-600"
          >
            <Text className="font-semibold text-white">
              {saving ? "Agregando..." : "Agregar a mi tienda"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {tool === "sale" ? (
        <View className="w-full max-w-xl self-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <Text className="text-base font-semibold text-slate-900">
            Registrar venta
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            {products.map((product) => (
              <Pressable
                key={product.id}
                onPress={() => setSelectedProductId(product.id)}
                className={`rounded-xl border px-3 py-2 ${selectedProductId === product.id ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
              >
                <Text className="text-xs font-semibold text-slate-800">
                  {product.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={saleQty}
            onChangeText={setSaleQty}
            keyboardType="numeric"
            placeholder="Cantidad"
            placeholderTextColor="#94a3b8"
            className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-900"
          />
          <Pressable
            disabled={saving}
            onPress={() => void registerSale()}
            className="mt-3 min-h-[44px] items-center justify-center rounded-xl bg-emerald-600"
          >
            <Text className="font-semibold text-white">Confirmar venta</Text>
          </Pressable>
        </View>
      ) : null}

      <InventorySummaryCard {...summary} />
      <View className="w-full max-w-xl self-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <Text className="text-base font-semibold text-slate-900">
          Buscar y filtrar
        </Text>
        <View className="mt-3">
          <SearchBar value={search} onChangeText={setSearch} />
        </View>
        <View className="mt-3">
          <FilterTabs
            options={categories}
            value={categoryFilter}
            onChange={setCategoryFilter}
          />
        </View>
      </View>
      {loading ? (
        <Text className="py-6 text-center text-sm text-slate-500">
          Cargando catálogo...
        </Text>
      ) : null}
      {!loading && !stores.length ? (
        <EmptyState
          title="Sin tiendas disponibles"
          message="Completa el registro de una tienda para administrar su catálogo."
        />
      ) : null}
      {!loading && stores.length && !products.length ? (
        <EmptyState
          title="Catálogo vacío"
          message="Agrega productos desde el catálogo global para comenzar."
        />
      ) : null}
      {!loading && products.length ? (
        <View className="w-full max-w-xl self-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <Text className="text-base font-semibold text-slate-900">
            Catálogo de mi tienda
          </Text>
          <View className="mt-3 gap-3">
            {Object.entries(grouped).map(([category, list]) => (
              <View key={category}>
                <Text className="text-sm font-semibold text-emerald-800">
                  {category}
                </Text>
                <View className="mt-2 gap-2">
                  {list.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      updating={saving}
                      onUpdate={(changes) => updateProduct(product.id, changes)}
                      onRemove={() => removeProduct(product.id)}
                    />
                  ))}
                </View>
              </View>
            ))}
            {!Object.keys(grouped).length ? (
              <EmptyState
                title="Sin resultados"
                message="Prueba con otra categoría o limpia la búsqueda."
              />
            ) : null}
          </View>
        </View>
      ) : null}
      {summary.outOfStock > 0 ? (
        <AlertCard
          tone="critical"
          title="Productos agotados"
          description={`${summary.outOfStock} productos sin stock.`}
        />
      ) : null}
      {summary.lowStock > 0 ? (
        <AlertCard
          tone="warning"
          title="Stock bajo"
          description={`${summary.lowStock} productos con stock bajo.`}
        />
      ) : null}
      {error ? (
        <View className="w-full max-w-xl self-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
          <Text className="text-sm text-rose-700">{error}</Text>
        </View>
      ) : null}
      {feedback ? (
        <View className="w-full max-w-xl self-center rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2">
          <Text className="text-sm text-cyan-800">{feedback}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
