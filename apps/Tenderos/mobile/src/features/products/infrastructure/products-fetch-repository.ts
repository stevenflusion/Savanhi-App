import type {
  CatalogProduct,
  CatalogStoreProduct,
} from "@repo/api-contracts/catalog";

import type { AuthenticatedJsonRequest } from "@/src/features/auth/infrastructure/store-photos-fetch-repository";

import type {
  ProductsRepository,
  ProductsResult,
  ProductStore,
} from "../application/ports/products-repository";
import {
  NO_CATEGORY_LABEL,
  type Product,
  type ProductSaleUnit,
} from "../domain/product";
import { categorySlugFromName } from "../domain/product-category";

const STORES_FAILURE = "No se pudieron cargar tus tiendas.";
const CATALOG_FAILURE = "No se pudo cargar el catálogo.";

/** A store-private product row, as `GET /stores/:id/products` returns it. */
type StorePrivateProductRow = {
  id: string;
  name: string;
  categoryId?: string | null;
  categoryName?: string | null;
  price: number | null;
  stock: number;
  active: boolean;
  saleUnit?: ProductSaleUnit;
  integerOnly?: boolean;
};

/** `500 ml`, `Botella · 500 ml`, or an empty string when neither is known. */
export function catalogPresentationLabel(product: {
  presentation?: string | null;
  netContent?: number | null;
  netContentUnit?: string | null;
}): string {
  return [
    product.presentation,
    product.netContent && product.netContentUnit
      ? `${product.netContent} ${product.netContentUnit}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The newest Supermaxi reading, which is the only market reference the
 * catalog carries. The row's `observedAt` is an ISO TIMESTAMP and is used to
 * SORT and never rendered — S11 keeps clock times off every screen.
 */
function newestObservedPrice(product: CatalogProduct) {
  return (
    product.observedPrices
      ?.filter(
        (price) =>
          price.amount !== null &&
          price.source.toLowerCase().startsWith("supermaxi"),
      )
      .sort(
        (left, right) =>
          new Date(right.observedAt).getTime() -
          new Date(left.observedAt).getTime(),
      )[0] ?? null
  );
}

export function toSharedProduct(item: CatalogStoreProduct): Product {
  const inventoryRules = item as CatalogStoreProduct & {
    saleUnit?: ProductSaleUnit;
    integerOnly?: boolean;
  };

  return {
    id: item.id,
    name: item.product.commercialName,
    category: item.product.categoryName || NO_CATEGORY_LABEL,
    categoryKey: categorySlugFromName(item.product.categoryName),
    categoryId: item.product.categoryId ?? null,
    brand: item.product.brandName,
    presentation: catalogPresentationLabel(item.product),
    price: item.price,
    observedPrice: newestObservedPrice(item.product),
    stock: item.stock,
    active: item.active,
    saleUnit: inventoryRules.saleUnit ?? "unidad",
    integerOnly: inventoryRules.integerOnly ?? false,
    source: "shared",
    pricePending: item.price === null || item.price <= 0,
  };
}

export function toPrivateProduct(item: StorePrivateProductRow): Product {
  return {
    id: item.id,
    name: item.name,
    category: item.categoryName || NO_CATEGORY_LABEL,
    categoryKey: categorySlugFromName(item.categoryName),
    categoryId: item.categoryId ?? null,
    brand: "",
    presentation: "",
    price: item.price,
    observedPrice: null,
    stock: item.stock,
    active: item.active,
    saleUnit: item.saleUnit ?? "unidad",
    integerOnly: item.integerOnly ?? false,
    source: "private",
    pricePending: item.price === null || item.price <= 0,
  };
}

/**
 * The ONE place the product screens read a store's catalog from (S14).
 *
 * A body that cannot be parsed is a FAILURE and never an empty success, for
 * the reason the coupon reader already records: a screen must not render
 * "nothing here" for a response it simply could not read.
 */
export function createProductsFetchRepository(
  request: AuthenticatedJsonRequest,
): ProductsRepository {
  const readData = async <T>(
    path: string,
    fallback: string,
  ): Promise<ProductsResult<T>> => {
    const outcome = await request(path, undefined);
    if (!outcome.success) return { success: false, error: outcome.error };
    try {
      const body = (await outcome.response.json()) as { data?: T };
      if (body.data === undefined) return { success: false, error: fallback };
      return { success: true, data: body.data };
    } catch {
      return { success: false, error: fallback };
    }
  };

  return {
    listOwnStores: () =>
      readData<ProductStore[]>("/api/v1/tenderos/stores/me", STORES_FAILURE),

    async listStoreProducts(storeId) {
      const [shared, owned] = await Promise.all([
        readData<CatalogStoreProduct[]>(
          `/api/v1/tenderos/stores/${storeId}/catalog`,
          CATALOG_FAILURE,
        ),
        readData<StorePrivateProductRow[]>(
          `/api/v1/tenderos/stores/${storeId}/products`,
          CATALOG_FAILURE,
        ),
      ]);
      if (!shared.success) return shared;
      if (!owned.success) return owned;

      // Shared first, then the store's own: the order the workspace list has
      // always used, so the detail carousel and the list agree on position.
      return {
        success: true,
        data: [...shared.data.map(toSharedProduct), ...owned.data.map(toPrivateProduct)],
      };
    },
  };
}
