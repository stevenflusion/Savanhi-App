import type { CatalogProduct } from "@repo/api-contracts/catalog";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useAuth } from "../features/auth";
import type { Product } from "../features/products/domain/product";
import {
  catalogPresentationLabel,
  createProductsFetchRepository,
} from "../features/products/infrastructure/products-fetch-repository";
import { EmptyState } from "./EmptyState";
import { FilterTabs } from "./FilterTabs";
import { ProductCard } from "./ProductCard";
import { SearchBar } from "./SearchBar";

type Tool = "add" | "sale" | "inventory";
type Store = { id: string; name?: string };
type Category = { id: string; name: string; shared?: boolean };
type SaleUnit = Product["saleUnit"];

const ALL_CATEGORIES = "Todas";

export function ProductsWorkspace({
  addIntent = false,
  editProductId = "",
}: {
  addIntent?: boolean;
  /** The product the detail screen asked this tab to open the editor on. */
  editProductId?: string;
}) {
  const router = useRouter();
  const { requestAuthenticated } = useAuth();
  const repository = useMemo(
    () => createProductsFetchRepository(requestAuthenticated),
    [requestAuthenticated],
  );

  const [products, setProducts] = useState<Product[]>([]);
  const [globalProducts, setGlobalProducts] = useState<CatalogProduct[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [tool, setTool] = useState<Tool>("inventory");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [editingProductId, setEditingProductId] = useState("");
  const [saleQty, setSaleQty] = useState("1");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [categoriesList, setCategoriesList] = useState<Category[]>([]);
  const [saleUnit, setSaleUnit] = useState<SaleUnit>("unidad");
  const [integerOnly, setIntegerOnly] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const [privateName, setPrivateName] = useState("");
  const [privateCategory, setPrivateCategory] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  useEffect(() => {
    if (addIntent) setTool("add");
  }, [addIntent]);

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
      // The store list and the store's products come from the SHARED products
      // repository, which is what the product detail and the Perfil tab read
      // through too — one mapping for one catalog.
      const [storesResult, globalResponse] = await Promise.all([
        repository.listOwnStores(),
        requestJson("/api/v1/tenderos/catalog"),
      ]);
      if (!storesResult.success) throw new Error(storesResult.error);

      const nextStores = storesResult.data as Store[];
      const nextStoreId =
        storeId && nextStores.some((store) => store.id === storeId)
          ? storeId
          : (nextStores[0]?.id ?? "");
      setStores(nextStores);
      setStoreId(nextStoreId);
      setGlobalProducts((globalResponse.data ?? []) as CatalogProduct[]);
      if (!nextStoreId) {
        setProducts([]);
        return;
      }

      const [storeProducts, categoriesResponse] = await Promise.all([
        repository.listStoreProducts(nextStoreId),
        requestJson(`/api/v1/tenderos/stores/${nextStoreId}/product-categories`),
      ]);
      if (!storeProducts.success) throw new Error(storeProducts.error);

      setProducts(storeProducts.data);
      setCategoriesList((categoriesResponse.data ?? []) as Category[]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo cargar el catálogo.",
      );
    } finally {
      setLoading(false);
    }
  }, [repository, requestJson, storeId]);

  useFocusEffect(
    useCallback(() => {
      void loadCatalog();
    }, [loadCatalog]),
  );

  /**
   * The incoming edit intent is honoured ONCE, through a ref: the tab reloads
   * on every focus, and re-opening the editor each time would make closing it
   * impossible. An id that is not in the store is ignored rather than opening
   * someone else's card.
   */
  const editIntentApplied = useRef(false);
  useEffect(() => {
    if (editIntentApplied.current || !editProductId) return;
    if (!products.some((product) => product.id === editProductId)) return;
    editIntentApplied.current = true;
    setTool("inventory");
    setEditingProductId(editProductId);
  }, [editProductId, products]);

  const categories = useMemo(
    () => [
      ALL_CATEGORIES,
      ...Array.from(new Set(products.map((product) => product.category))),
    ],
    [products],
  );
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (categoryFilter === ALL_CATEGORIES || p.category === categoryFilter) &&
        (!query ||
          `${p.name} ${p.brand} ${p.category} ${p.presentation}`
            .toLowerCase()
            .includes(query)),
    );
  }, [products, search, categoryFilter]);
  const summary = useMemo(
    () => ({
      total: products.length,
      inStock: products.filter((p) => p.stock > 5).length,
      lowStock: products.filter((p) => p.stock > 0 && p.stock <= 5).length,
      outOfStock: products.filter((p) => p.stock === 0).length,
    }),
    [products],
  );

  const addProduct = async (productId: string) => {
    if (!storeId)
      return setFeedback(
        "No hay una tienda disponible para agregar productos.",
      );
    if (
      !Number.isFinite(Number(priceInput)) ||
      Number(priceInput) <= 0 ||
      !/^\d+(?:\.\d{1,2})?$/.test(priceInput.trim())
    ) {
      setError("Escribe un precio positivo con máximo dos decimales.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/v1/tenderos/stores/${storeId}/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          price: Number(priceInput),
          saleUnit,
          integerOnly,
        }),
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

  const createCategory = async () => {
    if (!newCategory.trim() || !storeId) return;
    setSaving(true);
    try {
      const result = await requestJson(
        `/api/v1/tenderos/stores/${storeId}/product-categories`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newCategory.trim() }),
        },
      );
      const value = result.data as Category;
      setCategoriesList((current) => [...current, value]);
      setPrivateCategory(value.id);
      setNewCategory("");
      setCreatingCategory(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo crear la categoría.",
      );
    } finally {
      setSaving(false);
    }
  };

  const createPrivateProduct = async () => {
    const price = Number(priceInput);
    if (
      !privateName.trim() ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !/^\d+(?:\.\d{1,2})?$/.test(priceInput.trim())
    ) {
      setError(
        "Escribe un nombre y un precio positivo con máximo dos decimales.",
      );
      return;
    }
    setSaving(true);
    try {
      await requestJson(`/api/v1/tenderos/stores/${storeId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: privateName.trim(),
          price,
          stock: 1,
          saleUnit,
          integerOnly,
          ...(privateCategory ? { categoryId: privateCategory } : {}),
        }),
      });
      setPrivateName("");
      setPriceInput("");
      await loadCatalog();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo crear el producto.",
      );
    } finally {
      setSaving(false);
    }
  };

  const updateProduct = async (
    id: string,
    changes: {
      price?: number | null;
      stock?: number;
      active?: boolean;
      saleUnit?: SaleUnit;
      integerOnly?: boolean;
    },
  ) => {
    setSaving(true);
    setError("");
    try {
      const product = products.find((item) => item.id === id);
      const endpoint =
        product?.source === "private"
          ? `/api/v1/tenderos/products/${id}`
          : `/api/v1/tenderos/store-catalog-products/${id}`;
      if (
        changes.active === true &&
        (product?.price === null ||
          product?.price === undefined ||
          product.price <= 0) &&
        !(changes.price && changes.price > 0)
      ) {
        setError("Escribe un precio positivo antes de activar este producto.");
        return;
      }
      await requestJson(endpoint, {
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
      const product = products.find((item) => item.id === id);
      const endpoint =
        product?.source === "private"
          ? `/api/v1/tenderos/products/${id}`
          : `/api/v1/tenderos/store-catalog-products/${id}`;
      await requestJson(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
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
      !Number.isFinite(quantity) ||
      (product.saleUnit === "unidad" || product.integerOnly
        ? !Number.isInteger(quantity)
        : !/^\d+(?:\.\d{1,3})?$/.test(saleQty.trim())) ||
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
        paddingBottom: 140,
        gap: 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View className="w-full max-w-xl flex-row flex-wrap gap-2 self-center">
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
            accessibilityRole="button"
            accessibilityState={{ selected: tool === action.value }}
            onPress={() => setTool(action.value)}
            className={`min-h-[44px] min-w-[31%] flex-1 items-center justify-center rounded-full px-3 ${
              tool === action.value ? "bg-black" : "bg-white"
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                tool === action.value ? "text-white" : "text-slate-700"
              }`}
            >
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {stores.length > 1 ? (
        <View className="w-full max-w-xl flex-row flex-wrap gap-2 self-center">
          {stores.map((store) => (
            <Pressable
              key={store.id}
              accessibilityRole="button"
              onPress={() => setStoreId(store.id)}
              className={`rounded-full px-4 py-2 ${
                storeId === store.id ? "bg-black" : "bg-white"
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  storeId === store.id ? "text-white" : "text-slate-700"
                }`}
              >
                {store.name || "Tienda"}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {tool === "add" ? (
        <View className="w-full max-w-xl self-center rounded-3xl bg-white p-4 shadow-sm">
          <Text className="text-xl font-semibold tracking-tight text-slate-900">
            Elegir del catálogo global
          </Text>
          <Text className="mt-1 text-sm text-slate-500">
            Elige un producto del catálogo compartido y define su precio y
            unidad de venta. El stock empieza en 1.
          </Text>
          <TextInput
            value={priceInput}
            onChangeText={setPriceInput}
            placeholder="Precio (USD)"
            placeholderTextColor="#94a3b8"
            keyboardType="decimal-pad"
            className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-slate-900"
          />
          <View className="mt-3 flex-row flex-wrap gap-2">
            {(["unidad", "kg", "g", "L", "ml"] as const).map((unit) => (
              <Pressable
                key={unit}
                accessibilityRole="button"
                onPress={() => setSaleUnit(unit)}
                className={`rounded-full px-3 py-2 ${
                  saleUnit === unit ? "bg-black" : "bg-slate-100"
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    saleUnit === unit ? "text-white" : "text-slate-700"
                  }`}
                >
                  {unit}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => setIntegerOnly((value) => !value)}
              className="rounded-full bg-slate-100 px-3 py-2"
            >
              <Text className="text-xs font-semibold text-slate-700">
                {integerOnly
                  ? "Cantidades enteras"
                  : "Cantidades fraccionadas"}
              </Text>
            </Pressable>
          </View>

          <View className="mt-3 gap-2">
            {globalProducts.map((product) => (
              <Pressable
                key={product.id}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedProductId === product.id }}
                onPress={() => setSelectedProductId(product.id)}
                className={`rounded-2xl px-3 py-3 ${
                  selectedProductId === product.id
                    ? "bg-slate-900"
                    : "bg-slate-50"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    selectedProductId === product.id
                      ? "text-white"
                      : "text-slate-800"
                  }`}
                >
                  {product.commercialName}
                </Text>
                <Text
                  className={`mt-1 text-xs ${
                    selectedProductId === product.id
                      ? "text-slate-300"
                      : "text-slate-500"
                  }`}
                >
                  {product.categoryName} ·{" "}
                  {catalogPresentationLabel(product) ||
                    "Presentación no especificada"}
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
            accessibilityRole="button"
            disabled={!selectedProductId || saving}
            onPress={() => void addProduct(selectedProductId)}
            className="mt-4 min-h-[56px] items-center justify-center rounded-full bg-black px-5"
          >
            <Text className="text-base font-semibold text-white">
              {saving ? "Agregando..." : "Agregar a mi tienda"}
            </Text>
          </Pressable>

          <View className="mt-5 border-t border-slate-100 pt-4">
            <Text className="text-xl font-semibold tracking-tight text-slate-900">
              Agregar producto propio
            </Text>
            <TextInput
              value={privateName}
              onChangeText={setPrivateName}
              placeholder="Nombre del producto"
              placeholderTextColor="#94a3b8"
              className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-slate-900"
            />
            <View className="mt-3 flex-row flex-wrap gap-2">
              {categoriesList.map((category) => (
                <Pressable
                  key={category.id}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: privateCategory === category.id,
                  }}
                  onPress={() => setPrivateCategory(category.id)}
                  className={`rounded-full px-3 py-2 ${
                    privateCategory === category.id
                      ? "bg-black"
                      : "bg-slate-100"
                  }`}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      privateCategory === category.id
                        ? "text-white"
                        : "text-slate-700"
                    }`}
                  >
                    {category.name}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                onPress={() => setCreatingCategory(true)}
                className="rounded-full bg-slate-100 px-3 py-2"
              >
                <Text className="text-xs font-semibold text-slate-700">
                  Crear categoría
                </Text>
              </Pressable>
            </View>
            {creatingCategory ? (
              <View className="mt-3 flex-row gap-2">
                <TextInput
                  value={newCategory}
                  onChangeText={setNewCategory}
                  placeholder="Nombre de la categoría"
                  placeholderTextColor="#94a3b8"
                  className="flex-1 rounded-2xl bg-slate-50 px-4 py-3 text-slate-900"
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void createCategory()}
                  className="min-h-[44px] items-center justify-center rounded-full border border-slate-200 px-4"
                >
                  <Text className="text-sm font-semibold text-slate-900">
                    Guardar categoría
                  </Text>
                </Pressable>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => void createPrivateProduct()}
              disabled={saving}
              className="mt-4 min-h-[56px] items-center justify-center rounded-full bg-black px-5"
            >
              <Text className="text-base font-semibold text-white">
                Guardar producto propio
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {tool === "sale" ? (
        <View className="w-full max-w-xl self-center rounded-3xl bg-white p-4 shadow-sm">
          <Text className="text-xl font-semibold tracking-tight text-slate-900">
            Registrar venta
          </Text>
          <View testID="sale-products" className="mt-3 flex-row flex-wrap gap-2">
            {products.map((product) => (
              <Pressable
                key={product.id}
                accessibilityRole="button"
                accessibilityState={{
                  selected: selectedProductId === product.id,
                }}
                onPress={() => setSelectedProductId(product.id)}
                className={`rounded-full px-3 py-2 ${
                  selectedProductId === product.id ? "bg-black" : "bg-slate-100"
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    selectedProductId === product.id
                      ? "text-white"
                      : "text-slate-800"
                  }`}
                >
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
            className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-slate-900"
          />
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void registerSale()}
            className="mt-4 min-h-[56px] items-center justify-center rounded-full bg-black px-5"
          >
            <Text className="text-base font-semibold text-white">
              Confirmar venta
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/*
        The inventory summary replaces the old bordered card AND the two alert
        cards under the list: they restated these very counts, so the tendero
        read "3 productos con stock bajo" twice on one screenful.
      */}
      <View className="w-full max-w-xl flex-row gap-2 self-center">
        <StatPill label="Productos" value={summary.total} />
        <StatPill label="Con stock" value={summary.inStock} />
        <StatPill label="Stock bajo" value={summary.lowStock} tone="warning" />
        <StatPill label="Agotados" value={summary.outOfStock} tone="critical" />
      </View>

      <SearchBar value={search} onChangeText={setSearch} />
      <FilterTabs
        testID="category-filters"
        options={categories}
        value={categoryFilter}
        onChange={setCategoryFilter}
      />

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
        <View className="w-full max-w-xl gap-3 self-center">
          {filteredProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              updating={saving}
              expanded={editingProductId === product.id}
              onOpen={() => router.push(`/product/${product.id}`)}
              onToggleEdit={() =>
                setEditingProductId((current) =>
                  current === product.id ? "" : product.id,
                )
              }
              onUpdate={(changes) => updateProduct(product.id, changes)}
              onRemove={() => removeProduct(product.id)}
            />
          ))}
          {!filteredProducts.length ? (
            <EmptyState
              title="Sin resultados"
              message="Prueba con otra categoría o limpia la búsqueda."
            />
          ) : null}
        </View>
      ) : null}

      {error ? (
        <View className="w-full max-w-xl self-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <Text className="text-sm text-rose-700">{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadCatalog()}>
            <Text className="mt-2 text-sm font-semibold text-rose-800">
              Reintentar
            </Text>
          </Pressable>
        </View>
      ) : null}
      {feedback ? (
        <View className="w-full max-w-xl self-center rounded-2xl bg-white px-4 py-3 shadow-sm">
          <Text className="text-sm text-slate-600">{feedback}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function StatPill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "warning" | "critical";
}) {
  const surface =
    tone === "critical"
      ? "bg-rose-50"
      : tone === "warning"
        ? "bg-amber-50"
        : "bg-white";
  const ink =
    tone === "critical"
      ? "text-rose-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-slate-900";

  return (
    <View className={`flex-1 items-center rounded-2xl px-2 py-3 ${surface}`}>
      <Text className={`text-xl font-semibold ${ink}`}>{value}</Text>
      <Text className="mt-0.5 text-center text-[11px] text-slate-500">
        {label}
      </Text>
    </View>
  );
}
