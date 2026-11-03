import type {
  CouponCreateRequest,
  CouponProductCategory,
  CouponProductRef,
  CouponUpdateRequest,
} from "@repo/api-contracts";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { AppError } from "../../errors.js";
import type { DatabaseConnection } from "../connection.js";
import {
  mapCoupon,
  type CouponProductDetailRecord,
  type CouponRecord,
} from "../mappers.js";
import {
  catalogCategories,
  catalogProducts,
  couponProducts,
  coupons,
  products,
  storeCatalogProducts,
  storeProductCategories,
} from "../schema.js";

/** A transaction handle, so one write path can span several statements. */
type Tx = Parameters<Parameters<DatabaseConnection["transaction"]>[0]>[0];
type Executor = DatabaseConnection | Tx;

/**
 * The database constraints T3 installed are the real invariants; this maps the
 * ones a client can trip into the status that describes them, so a driver error
 * never reaches the HTTP boundary as a 500.
 *
 * 409 is for a payload that conflicts with STORED state (claims already made,
 * a key or a product already linked); 400 is for a payload that is wrong on its
 * own terms. The contract layer rejects most of the 400 cases before a
 * statement runs, so these are the last line, not the first.
 */
const CONSTRAINT_FAILURES: Record<
  string,
  { message: string; statusCode: number }
> = {
  coupons_type_chk: {
    message: "Unknown coupon type.",
    statusCode: 400,
  },
  coupons_type_value_chk: {
    message: "This coupon type does not carry that value.",
    statusCode: 400,
  },
  coupons_percentage_range_chk: {
    message: "A percentage discount must be between 1 and 100.",
    statusCode: 400,
  },
  coupons_fixed_amount_positive_chk: {
    message: "A fixed amount must be greater than zero.",
    statusCode: 400,
  },
  coupons_validity_order_chk: {
    message: "The validity must start on or before it ends.",
    statusCode: 400,
  },
  coupons_total_stock_nonnegative_chk: {
    message: "The total stock cannot be negative.",
    statusCode: 400,
  },
  coupons_claimed_within_stock_chk: {
    message:
      "The total stock cannot be lower than the number of claims already made.",
    statusCode: 409,
  },
  coupons_image_object_key_uidx: {
    message: "This image is already used by another coupon.",
    statusCode: 409,
  },
  coupon_products_coupon_catalog_uidx: {
    message: "A coupon cannot reference the same product twice.",
    statusCode: 409,
  },
  coupon_products_coupon_private_uidx: {
    message: "A coupon cannot reference the same product twice.",
    statusCode: 409,
  },
  coupon_products_single_source_chk: {
    message: "A coupon product names exactly one product source.",
    statusCode: 400,
  },
};

/**
 * Drizzle wraps the failed statement, and the `pg` error that carries
 * `constraint` sits on the cause chain rather than on the thrown error.
 */
function violatedConstraint(error: unknown): string | undefined {
  let current = error;
  while (current instanceof Error) {
    const name = (current as { constraint?: unknown }).constraint;
    if (typeof name === "string") return name;
    current = current.cause;
  }
  return undefined;
}

/** Translates a known constraint violation; anything else keeps bubbling. */
async function mappingConstraints<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const failure = CONSTRAINT_FAILURES[violatedConstraint(error) ?? ""];
    if (failure) {
      throw new AppError(failure.message, failure.statusCode);
    }
    throw error;
  }
}

/** The pair, not the id alone, identifies a reference: the sources differ. */
const refKey = (ref: CouponProductRef) => `${ref.source}:${ref.productId}`;

/**
 * A store-authored category name is free text the tendero typed, so it has no
 * slug and therefore no stable icon key; a catalog category's slug IS that key.
 * Both return null when the left join found no row, so the category is absent
 * as a whole rather than an id with a missing name.
 */
const storeCategory = (
  id: string | null,
  name: string | null,
): CouponProductCategory | null =>
  id === null || name === null ? null : { id, name, key: null };

const catalogCategory = (
  id: string | null,
  name: string | null,
  slug: string | null,
): CouponProductCategory | null =>
  id === null || name === null ? null : { id, name, key: slug };

export function createCouponsRepository(db: DatabaseConnection) {
  /**
   * S5 — every reference must belong to the OWNING store, as a store catalog
   * assignment or as a store-private product. The check runs inside the write
   * transaction and before any insert, so a rejected payload leaves nothing
   * behind, including when only one product of a combo is foreign.
   */
  async function assertProductsBelongToStore(
    executor: Executor,
    storeId: string,
    refs: CouponProductRef[],
  ) {
    const catalogIds = refs
      .filter((ref) => ref.source === "store_catalog")
      .map((ref) => ref.productId);
    const privateIds = refs
      .filter((ref) => ref.source === "store_private")
      .map((ref) => ref.productId);

    const owned = new Set<string>();
    if (catalogIds.length > 0) {
      const rows = await executor
        .select({ id: storeCatalogProducts.id })
        .from(storeCatalogProducts)
        .where(
          and(
            inArray(storeCatalogProducts.id, catalogIds),
            eq(storeCatalogProducts.storeId, storeId),
          ),
        );
      for (const row of rows) owned.add(`store_catalog:${row.id}`);
    }
    if (privateIds.length > 0) {
      const rows = await executor
        .select({ id: products.id })
        .from(products)
        .where(
          and(inArray(products.id, privateIds), eq(products.storeId, storeId)),
        );
      for (const row of rows) owned.add(`store_private:${row.id}`);
    }

    if (refs.some((ref) => !owned.has(refKey(ref)))) {
      throw new AppError(
        "Every coupon product must belong to this store.",
        400,
      );
    }
  }

  /** The column pair `coupon_products_single_source_chk` expects (S5). */
  const productValues = (couponId: string, ref: CouponProductRef) => ({
    couponId,
    storeCatalogProductId:
      ref.source === "store_catalog" ? ref.productId : null,
    storeProductId: ref.source === "store_private" ? ref.productId : null,
  });

  /**
   * Resolves a coupon for the authenticated tendero. A coupon that exists but
   * belongs to another tendero is a 403, not a 404: the id came from somewhere,
   * and pretending it is missing would be a different (and wrong) story.
   */
  async function findOwned(
    couponId: string,
    storeIds: string[],
  ): Promise<typeof coupons.$inferSelect> {
    const [row] = await db
      .select()
      .from(coupons)
      .where(eq(coupons.id, couponId));
    if (!row) throw new AppError("Coupon not found.", 404);
    if (!storeIds.includes(row.storeId)) {
      throw new AppError("Coupon does not belong to this tendero.", 403);
    }
    return row;
  }

  return {
    /**
     * Creates the coupon and its product links in ONE transaction, so a
     * rejected product reference or a tripped constraint leaves no coupon
     * without products — the single state S5 forbids.
     */
    async createForStore(
      storeId: string,
      payload: CouponCreateRequest,
    ): Promise<CouponRecord> {
      return mappingConstraints(() =>
        db.transaction(async (tx) => {
          await assertProductsBelongToStore(tx, storeId, payload.products);

          const [row] = await tx
            .insert(coupons)
            .values({
              storeId,
              type: payload.type,
              title: payload.title,
              description: payload.description ?? null,
              freeText: payload.type === "free_text" ? payload.freeText : null,
              percentageValue:
                payload.type === "percentage" ? payload.percentageValue : null,
              fixedAmountValue:
                payload.type === "fixed_amount"
                  ? String(payload.fixedAmountValue)
                  : null,
              validFrom: payload.validFrom,
              validTo: payload.validTo,
              totalStock: payload.totalStock,
              paused: payload.paused,
              imageObjectKey: payload.imageObjectKey ?? null,
            })
            .returning();
          if (!row) throw new AppError("Unable to create the coupon.", 502);

          await tx
            .insert(couponProducts)
            .values(
              payload.products.map((ref) => productValues(row.id, ref)),
            );

          return mapCoupon(row);
        }),
      );
    },

    async listByStoreIds(storeIds: string[]): Promise<CouponRecord[]> {
      if (!storeIds.length) return [];
      return (
        await db
          .select()
          .from(coupons)
          .where(inArray(coupons.storeId, storeIds))
          .orderBy(desc(coupons.createdAt))
      ).map(mapCoupon);
    },

    async findForStores(
      couponId: string,
      storeIds: string[],
    ): Promise<CouponRecord> {
      return mapCoupon(await findOwned(couponId, storeIds));
    },

    /**
     * The payload restates the coupon's `type`, which is NOT mutable: a
     * restated type that differs from the stored one conflicts with stored
     * state, so it is a 409 and nothing is written. Replacing the product set
     * happens in the same transaction as the column update.
     */
    async updateForStores(
      couponId: string,
      storeIds: string[],
      payload: CouponUpdateRequest,
    ): Promise<CouponRecord> {
      const current = await findOwned(couponId, storeIds);
      if (payload.type !== current.type) {
        throw new AppError("The coupon type cannot be changed.", 409);
      }

      return mappingConstraints(() =>
        db.transaction(async (tx) => {
          if (payload.products !== undefined) {
            await assertProductsBelongToStore(
              tx,
              current.storeId,
              payload.products,
            );
            await tx
              .delete(couponProducts)
              .where(eq(couponProducts.couponId, couponId));
            await tx
              .insert(couponProducts)
              .values(
                payload.products.map((ref) => productValues(couponId, ref)),
              );
          }

          const [row] = await tx
            .update(coupons)
            .set({
              title: payload.title,
              description: payload.description,
              freeText:
                payload.type === "free_text" ? payload.freeText : undefined,
              percentageValue:
                payload.type === "percentage"
                  ? payload.percentageValue
                  : undefined,
              fixedAmountValue:
                payload.type === "fixed_amount" &&
                payload.fixedAmountValue !== undefined
                  ? String(payload.fixedAmountValue)
                  : undefined,
              validFrom: payload.validFrom,
              validTo: payload.validTo,
              totalStock: payload.totalStock,
              paused: payload.paused,
              imageObjectKey: payload.imageObjectKey,
              updatedAt: new Date(),
            })
            .where(eq(coupons.id, couponId))
            .returning();
          if (!row) throw new AppError("Coupon not found.", 404);
          return mapCoupon(row);
        }),
      );
    },

    /**
     * Pausing blocks NEW claims only; the existing claims stay untouched and
     * stay redeemable (S6). Both directions are idempotent, so the response is
     * the end state rather than a report of what changed.
     */
    async setPausedForStores(
      couponId: string,
      storeIds: string[],
      paused: boolean,
    ): Promise<CouponRecord> {
      await findOwned(couponId, storeIds);
      const [row] = await db
        .update(coupons)
        .set({ paused, updatedAt: new Date() })
        .where(eq(coupons.id, couponId))
        .returning();
      if (!row) throw new AppError("Coupon not found.", 404);
      return mapCoupon(row);
    },

    /**
     * Stores the image reference. The route has already checked that the key
     * belongs to this coupon's store prefix; the unique index is what stops two
     * coupons from claiming the same object.
     */
    async setImageForStores(
      couponId: string,
      storeIds: string[],
      objectKey: string,
    ): Promise<CouponRecord> {
      await findOwned(couponId, storeIds);
      return mappingConstraints(async () => {
        const [row] = await db
          .update(coupons)
          .set({ imageObjectKey: objectKey, updatedAt: new Date() })
          .where(eq(coupons.id, couponId))
          .returning();
        if (!row) throw new AppError("Coupon not found.", 404);
        return mapCoupon(row);
      });
    },

    /**
     * The product references of several coupons at once, each with the name its
     * source holds and the category the app maps an icon from (S10), so a
     * coupon list renders in two queries instead of one per coupon.
     *
     * A catalog product always has a catalog category (`category_id` is NOT
     * NULL there), so its join is inner and its `key` is the slug. A
     * store-private product may have a store-authored category, a catalog one,
     * or neither, so both joins are left joins and the precedence is the one
     * the products repository already applies (`storeCategoryId ??
     * categoryId`).
     */
    async listProductDetailsByCouponIds(
      couponIds: string[],
    ): Promise<CouponProductDetailRecord[]> {
      if (!couponIds.length) return [];
      const [catalogRows, privateRows] = await Promise.all([
        db
          .select({
            couponId: couponProducts.couponId,
            productId: storeCatalogProducts.id,
            name: catalogProducts.commercialName,
            categoryId: catalogCategories.id,
            categoryName: catalogCategories.name,
            categorySlug: catalogCategories.slug,
          })
          .from(couponProducts)
          .innerJoin(
            storeCatalogProducts,
            eq(couponProducts.storeCatalogProductId, storeCatalogProducts.id),
          )
          .innerJoin(
            catalogProducts,
            eq(storeCatalogProducts.productId, catalogProducts.id),
          )
          .innerJoin(
            catalogCategories,
            eq(catalogProducts.categoryId, catalogCategories.id),
          )
          .where(inArray(couponProducts.couponId, couponIds))
          .orderBy(asc(couponProducts.createdAt)),
        db
          .select({
            couponId: couponProducts.couponId,
            productId: products.id,
            name: products.name,
            storeCategoryId: storeProductCategories.id,
            storeCategoryName: storeProductCategories.name,
            categoryId: catalogCategories.id,
            categoryName: catalogCategories.name,
            categorySlug: catalogCategories.slug,
          })
          .from(couponProducts)
          .innerJoin(products, eq(couponProducts.storeProductId, products.id))
          .leftJoin(
            storeProductCategories,
            eq(products.storeCategoryId, storeProductCategories.id),
          )
          .leftJoin(
            catalogCategories,
            eq(products.categoryId, catalogCategories.id),
          )
          .where(inArray(couponProducts.couponId, couponIds))
          .orderBy(asc(couponProducts.createdAt)),
      ]);

      return [
        ...catalogRows.map(
          ({ categoryId, categoryName, categorySlug, ...row }) => ({
            ...row,
            source: "store_catalog" as const,
            category: {
              id: categoryId,
              name: categoryName,
              key: categorySlug,
            },
          }),
        ),
        ...privateRows.map(
          ({
            storeCategoryId,
            storeCategoryName,
            categoryId,
            categoryName,
            categorySlug,
            ...row
          }) => ({
            ...row,
            source: "store_private" as const,
            category: storeCategory(storeCategoryId, storeCategoryName) ??
              catalogCategory(categoryId, categoryName, categorySlug),
          }),
        ),
      ];
    },
  };
}
