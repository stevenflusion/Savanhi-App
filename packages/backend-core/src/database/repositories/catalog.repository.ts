import type {
  CatalogProduct,
  CatalogStoreProduct,
  CatalogStoreProductRequest,
  CatalogStoreProductUpdateRequest,
} from "@repo/api-contracts/catalog";
import { and, desc, eq, inArray } from "drizzle-orm";
import { AppError } from "../../errors.js";
import type { DatabaseConnection } from "../connection.js";
import {
  catalogBrands,
  catalogCategories,
  catalogObservedPrices,
  catalogProductIdentifiers,
  catalogProducts,
  storeCatalogProducts,
} from "../schema.js";

type CatalogProductRow = {
  product: typeof catalogProducts.$inferSelect;
  category: typeof catalogCategories.$inferSelect;
  brand: typeof catalogBrands.$inferSelect;
};

function mapCatalogProduct(
  row: CatalogProductRow,
  identifiers: (typeof catalogProductIdentifiers.$inferSelect)[],
  observedPrices: (typeof catalogObservedPrices.$inferSelect)[],
): CatalogProduct {
  return {
    id: row.product.id,
    categoryId: row.product.categoryId,
    categoryName: row.category.name,
    brandId: row.product.brandId,
    brandName: row.brand.name,
    commercialName: row.product.commercialName,
    description: row.product.description,
    variant: row.product.variant,
    presentation: row.product.presentation,
    unitsPerPackage: row.product.unitsPerPackage,
    netContent:
      row.product.netContent === null ? null : Number(row.product.netContent),
    netContentUnit: row.product.netContentUnit,
    identifiers: identifiers.map((identifier) => ({
      id: identifier.id,
      productId: identifier.productId,
      kind: identifier.kind,
      value: identifier.value,
      source: identifier.source,
      verified: identifier.verified,
      verifiedAt: identifier.verifiedAt?.toISOString() ?? null,
      notes: identifier.notes,
    })),
    observedPrices: observedPrices.map((price) => ({
      id: price.id,
      productId: price.productId,
      amount: price.amount === null ? null : Number(price.amount),
      currency: price.currency as "USD",
      city: price.city,
      source: price.source,
      observedAt: price.observedAt.toISOString(),
      verified: price.verified,
      notes: price.notes,
    })),
    active: row.product.active,
  };
}

function mapStoreCatalogProduct(
  row: CatalogProductRow & {
    storeProduct: typeof storeCatalogProducts.$inferSelect;
  },
  product: CatalogProduct,
): CatalogStoreProduct {
  return {
    id: row.storeProduct.id,
    storeId: row.storeProduct.storeId,
    productId: row.storeProduct.productId,
    price:
      row.storeProduct.price === null ? null : Number(row.storeProduct.price),
    currency: row.storeProduct.currency as "USD",
    stock: row.storeProduct.stock,
    active: row.storeProduct.active,
    product,
  };
}

export function createCatalogRepository(db: DatabaseConnection) {
  async function loadMetadata(productIds: string[]) {
    if (!productIds.length) return { identifiers: [], observedPrices: [] };
    const [identifiers, observedPrices] = await Promise.all([
      db
        .select()
        .from(catalogProductIdentifiers)
        .where(inArray(catalogProductIdentifiers.productId, productIds)),
      db
        .select()
        .from(catalogObservedPrices)
        .where(inArray(catalogObservedPrices.productId, productIds))
        .orderBy(desc(catalogObservedPrices.observedAt)),
    ]);
    return { identifiers, observedPrices };
  }

  function groupMetadata<T extends { productId: string }>(rows: T[]) {
    return rows.reduce((groups, row) => {
      const group = groups.get(row.productId) ?? [];
      group.push(row);
      groups.set(row.productId, group);
      return groups;
    }, new Map<string, T[]>());
  }

  async function mapProductRows(rows: CatalogProductRow[]) {
    const metadata = await loadMetadata(rows.map(({ product }) => product.id));
    const identifiers = groupMetadata(metadata.identifiers);
    const observedPrices = groupMetadata(metadata.observedPrices);
    return rows.map((row) =>
      mapCatalogProduct(
        row,
        identifiers.get(row.product.id) ?? [],
        observedPrices.get(row.product.id) ?? [],
      ),
    );
  }

  async function findStoreCatalogProduct(id: string, storeId: string) {
    const [row] = await db
      .select({
        storeProduct: storeCatalogProducts,
        product: catalogProducts,
        category: catalogCategories,
        brand: catalogBrands,
      })
      .from(storeCatalogProducts)
      .innerJoin(
        catalogProducts,
        eq(storeCatalogProducts.productId, catalogProducts.id),
      )
      .innerJoin(
        catalogCategories,
        eq(catalogProducts.categoryId, catalogCategories.id),
      )
      .innerJoin(catalogBrands, eq(catalogProducts.brandId, catalogBrands.id))
      .where(
        and(
          eq(storeCatalogProducts.id, id),
          eq(storeCatalogProducts.storeId, storeId),
        ),
      );
    if (!row) throw new AppError("Store catalog product not found.", 404);
    const [product] = await mapProductRows([row]);
    return mapStoreCatalogProduct(row, product as CatalogProduct);
  }

  return {
    async listGlobalActive() {
      return mapProductRows(
        await db
          .select({
            product: catalogProducts,
            category: catalogCategories,
            brand: catalogBrands,
          })
          .from(catalogProducts)
          .innerJoin(
            catalogCategories,
            eq(catalogProducts.categoryId, catalogCategories.id),
          )
          .innerJoin(
            catalogBrands,
            eq(catalogProducts.brandId, catalogBrands.id),
          )
          .where(
            and(
              eq(catalogProducts.active, true),
              eq(catalogCategories.active, true),
              eq(catalogBrands.active, true),
            ),
          )
          .orderBy(catalogProducts.commercialName),
      );
    },

    async listByStoreIds(storeIds: string[]) {
      if (!storeIds.length) return [];
      const rows = await db
        .select({
          storeProduct: storeCatalogProducts,
          product: catalogProducts,
          category: catalogCategories,
          brand: catalogBrands,
        })
        .from(storeCatalogProducts)
        .innerJoin(
          catalogProducts,
          eq(storeCatalogProducts.productId, catalogProducts.id),
        )
        .innerJoin(
          catalogCategories,
          eq(catalogProducts.categoryId, catalogCategories.id),
        )
        .innerJoin(catalogBrands, eq(catalogProducts.brandId, catalogBrands.id))
        .where(inArray(storeCatalogProducts.storeId, storeIds))
        .orderBy(catalogProducts.commercialName);
      const products = await mapProductRows(rows);
      const productsById = new Map(
        products.map((product) => [product.id, product]),
      );
      return rows.map((row) =>
        mapStoreCatalogProduct(
          row,
          productsById.get(row.product.id) as CatalogProduct,
        ),
      );
    },

    async addToStore(storeId: string, payload: CatalogStoreProductRequest) {
      const [product] = await db
        .select()
        .from(catalogProducts)
        .where(
          and(
            eq(catalogProducts.id, payload.productId),
            eq(catalogProducts.active, true),
          ),
        );
      if (!product) throw new AppError("Catalog product not found.", 404);

      await db
        .insert(storeCatalogProducts)
        .values({
          storeId,
          productId: payload.productId,
          price:
            payload.price === undefined || payload.price === null
              ? null
              : String(payload.price),
          stock: 1,
        })
        .onConflictDoNothing({
          target: [
            storeCatalogProducts.storeId,
            storeCatalogProducts.productId,
          ],
        });

      const [row] = await db
        .select()
        .from(storeCatalogProducts)
        .where(
          and(
            eq(storeCatalogProducts.storeId, storeId),
            eq(storeCatalogProducts.productId, payload.productId),
          ),
        );
      if (!row) throw new AppError("Unable to add catalog product.", 502);
      return findStoreCatalogProduct(row.id, storeId);
    },

    async updateForStores(
      id: string,
      storeIds: string[],
      payload: CatalogStoreProductUpdateRequest,
    ) {
      if (!storeIds.length)
        throw new AppError("Store catalog product not found.", 404);
      const [row] = await db
        .update(storeCatalogProducts)
        .set({
          price:
            payload.price === undefined || payload.price === null
              ? payload.price
              : String(payload.price),
          stock: payload.stock,
          active: payload.active,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(storeCatalogProducts.id, id),
            inArray(storeCatalogProducts.storeId, storeIds),
          ),
        )
        .returning();
      if (!row) throw new AppError("Store catalog product not found.", 404);
      return findStoreCatalogProduct(row.id, row.storeId);
    },

    async deactivateForStores(id: string, storeIds: string[]) {
      if (!storeIds.length)
        throw new AppError("Store catalog product not found.", 404);
      const [row] = await db
        .update(storeCatalogProducts)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(storeCatalogProducts.id, id),
            inArray(storeCatalogProducts.storeId, storeIds),
          ),
        )
        .returning();
      if (!row) throw new AppError("Store catalog product not found.", 404);
      return findStoreCatalogProduct(row.id, row.storeId);
    },
  };
}
