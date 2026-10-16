import type { ProductRequest } from "@repo/api-contracts/products";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "../../errors.js";
import type { DatabaseConnection } from "../connection.js";
import {
  products,
  storeProductCategories,
  catalogCategories,
} from "../schema.js";
import { mapProduct } from "../mappers.js";

type StoreProductInput = ProductRequest & {
  stock?: number;
  saleUnit?: "unidad" | "kg" | "g" | "L" | "ml";
  integerOnly?: boolean;
  categoryId?: string | null;
};

export function createProductsRepository(db: DatabaseConnection) {
  const mapInventoryProduct = (row: typeof products.$inferSelect) => ({
    ...mapProduct(row),
    price: row.price === null ? null : Number(row.price),
    stock: Number(row.stock),
    saleUnit: row.saleUnit as "unidad" | "kg" | "g" | "L" | "ml",
    integerOnly: row.integerOnly,
    categoryId: row.storeCategoryId ?? row.categoryId,
    pricePending: row.price === null || Number(row.price) <= 0,
  });

  async function categoryValues(
    storeId: string,
    categoryId: string | null | undefined,
  ) {
    if (!categoryId) return { categoryId: null, storeCategoryId: null };
    const [shared] = await db
      .select({ id: catalogCategories.id })
      .from(catalogCategories)
      .where(
        and(
          eq(catalogCategories.id, categoryId),
          eq(catalogCategories.active, true),
        ),
      );
    if (shared) return { categoryId, storeCategoryId: null };
    const [owned] = await db
      .select({ id: storeProductCategories.id })
      .from(storeProductCategories)
      .where(
        and(
          eq(storeProductCategories.id, categoryId),
          eq(storeProductCategories.storeId, storeId),
          eq(storeProductCategories.active, true),
        ),
      );
    if (!owned)
      throw new AppError(
        "Product category does not belong to this store.",
        400,
      );
    return { categoryId: null, storeCategoryId: categoryId };
  }

  return {
    async listActive() {
      return (
        await db
          .select()
          .from(products)
          .where(eq(products.active, true))
          .orderBy(desc(products.createdAt))
      ).map(mapInventoryProduct);
    },
    async findActiveById(id: string) {
      const [row] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.active, true)));
      if (!row) throw new AppError("Product not found.", 404);
      return mapInventoryProduct(row);
    },
    async listRowsByIds(ids: string[]) {
      return db
        .select()
        .from(products)
        .where(and(inArray(products.id, ids), eq(products.active, true)));
    },
    async listByStoreIds(ids: string[]) {
      if (!ids.length) return [];
      return (
        await db
          .select()
          .from(products)
          .where(inArray(products.storeId, ids))
          .orderBy(desc(products.createdAt))
      ).map(mapInventoryProduct);
    },
    async createForStore(storeId: string, payload: StoreProductInput) {
      const category = await categoryValues(storeId, payload.categoryId);
      const [row] = await db
        .insert(products)
        .values({
          storeId,
          brandId: payload.brandId ?? null,
          name: payload.name,
          description: payload.description ?? null,
          price: String(payload.price),
          stock: payload.stock ?? 1,
          saleUnit: payload.saleUnit ?? "unidad",
          integerOnly: payload.integerOnly ?? false,
          categoryId: category.categoryId,
          storeCategoryId: category.storeCategoryId,
          active: payload.active ?? true,
        })
        .returning();
      if (!row) throw new AppError("Unable to create product.", 502);
      return mapInventoryProduct(row);
    },
    async updateForStores(
      id: string,
      storeIds: string[],
      payload: Partial<StoreProductInput>,
    ) {
      if (!storeIds.length) throw new AppError("Product not found.", 404);
      const [current] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, id), inArray(products.storeId, storeIds)));
      if (!current) throw new AppError("Product not found.", 404);
      const nextPrice =
        payload.price === undefined ? current.price : payload.price;
      if (
        payload.active === true &&
        (nextPrice == null || Number(nextPrice) <= 0)
      ) {
        throw new AppError(
          "A positive price is required before activation.",
          400,
        );
      }
      const category =
        payload.categoryId === undefined
          ? undefined
          : await categoryValues(current.storeId ?? "", payload.categoryId);
      const nextStock = payload.stock ?? Number(current.stock);
      const nextUnit = payload.saleUnit ?? current.saleUnit;
      const nextIntegerOnly = payload.integerOnly ?? current.integerOnly;
      if (
        (nextUnit === "unidad" || nextIntegerOnly) &&
        !Number.isInteger(nextStock)
      )
        throw new AppError("This sale unit requires whole-number stock.", 400);
      const [row] = await db
        .update(products)
        .set({
          storeId: payload.storeId === undefined ? undefined : payload.storeId,
          brandId: payload.brandId,
          name: payload.name,
          description: payload.description,
          price:
            payload.price === undefined ? undefined : String(payload.price),
          stock: payload.stock,
          saleUnit: payload.saleUnit,
          integerOnly: payload.integerOnly,
          categoryId: category?.categoryId,
          storeCategoryId: category?.storeCategoryId,
          active: payload.active,
        })
        .where(and(eq(products.id, id), inArray(products.storeId, storeIds)))
        .returning();
      if (!row) throw new AppError("Product not found.", 404);
      return mapInventoryProduct(row);
    },
    async deactivateForStores(id: string, storeIds: string[]) {
      const [row] = await db
        .update(products)
        .set({ active: false })
        .where(and(eq(products.id, id), inArray(products.storeId, storeIds)))
        .returning();
      if (!row) throw new AppError("Product not found.", 404);
      return mapInventoryProduct(row);
    },
    async count() {
      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(products);
      return Number(result?.count ?? 0);
    },
  };
}
