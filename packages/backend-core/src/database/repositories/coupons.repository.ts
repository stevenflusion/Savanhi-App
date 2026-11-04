import type {
  CouponCreateRequest,
  CouponProductCategory,
  CouponProductRef,
  CouponUpdateRequest,
} from "@repo/api-contracts";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { customerDisplayName } from "../../coupons/customer-name.js";
import { createQrToken, hashQrToken } from "../../coupons/qr-token.js";
import { AppError } from "../../errors.js";
import { couponCalendarToday } from "../calendar.js";
import type { DatabaseConnection } from "../connection.js";
import {
  mapCoupon,
  type ClaimableCouponRecord,
  type CouponMetricsRecord,
  type CouponProductDetailRecord,
  type CouponRecord,
  type CouponRedemptionEntryRecord,
  type CouponRedemptionRecord,
  type CustomerClaimRecord,
} from "../mappers.js";
import {
  catalogCategories,
  catalogProducts,
  couponClaims,
  couponProducts,
  coupons,
  products,
  storeCatalogProducts,
  storeProductCategories,
  stores,
  users,
} from "../schema.js";

/** A transaction handle, so one write path can span several statements. */
type Tx = Parameters<Parameters<DatabaseConnection["transaction"]>[0]>[0];
type Executor = DatabaseConnection | Tx;

/**
 * The customer gave the coupon back (C4), so every path that could still USE
 * the claim answers this: the tendero's preview, the redemption and the QR
 * re-issue. It is a 409 and not a 404, because the claim exists and the
 * conflict is with its stored state.
 *
 * It is declared here, above the constraint table below, because that table is
 * built at module load and reads this value.
 */
const RELEASED_MESSAGE = "This claim was released and is no longer valid.";

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
  /**
   * Once per customer (S6). The claim path checks for an existing claim first
   * to answer with this message without a failed statement; this entry is what
   * keeps the answer right when two of the customer's own requests race.
   */
  coupon_claims_coupon_customer_uidx: {
    message: "You have already claimed this coupon.",
    statusCode: 409,
  },
  /**
   * A released claim can never be redeemed and a redeemed one can never be
   * released (C4). Both paths answer before their statement runs; this is what
   * answers if one of them ever stops checking.
   */
  coupon_claims_release_chk: {
    message: RELEASED_MESSAGE,
    statusCode: 409,
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
 * The ONE answer to a scan this tendero cannot redeem — a token that matches
 * nothing and a live token belonging to another store's claim read exactly the
 * same.
 *
 * This is a deliberate departure from the 403 the coupon and claim routes
 * answer for someone else's id (T4/T5). That convention rests on the id having
 * come from somewhere legitimate; a QR token is a bearer secret the tendero was
 * never meant to hold, so telling them "this one exists, just not here" both
 * confirms the secret is live and leaks that another store issued it.
 */
const QR_NOT_FOUND_MESSAGE = "No claim matches this QR code.";

/** Redemption happens once (S8); the second scan of a QR is a conflict. */
const ALREADY_REDEEMED_MESSAGE = "This coupon has already been redeemed.";

/** The validity end date is the hard limit, paused or not (S6, L6). */
const NO_LONGER_VALID_MESSAGE = "This coupon is no longer valid.";

/** The answer to the second release of one claim; never a second decrement. */
const ALREADY_RELEASED_MESSAGE = "This claim was already released.";

/**
 * Once per customer survives the release (S6, C4): the claim row stays as
 * data, so the customer cannot take the same coupon twice. This wording tells
 * them WHY, which the generic "already claimed" message could not.
 */
const ALREADY_RELEASED_CLAIM_MESSAGE =
  "You already released this coupon and cannot claim it again.";

/** A customer with no renderable name cannot claim (C2). */
const NAME_REQUIRED_MESSAGE = "Add your name before claiming a coupon.";

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
   * Resolves a scanned QR token to its claim, with everything the tendero's
   * confirmation screen renders and the two pieces of stored state redemption
   * is gated on: who owns the store and whether the validity has passed.
   *
   * The token is matched by its HASH, which is all the database holds (S3), so
   * the plaintext is never compared against anything stored.
   *
   * `for update of coupon_claims` locks ONLY the claim row — not the coupon and
   * not the store, which other requests keep writing. Two parallel scans of one
   * token therefore serialise here: the second waits, reads the committed
   * `redeemed` status and is rejected. The preview locks the same way, so it can
   * never report a state a redemption has already committed; it just writes
   * nothing.
   */
  async function readRedemption(executor: Tx, qrToken: string) {
    const today = couponCalendarToday();
    const [row] = await executor
      .select({
        claim: couponClaims,
        coupon: coupons,
        storeId: stores.id,
        storeName: stores.name,
        storeOwnerUserId: stores.ownerUserId,
        customerFullName: users.fullName,
        expired: sql<boolean>`${coupons.validTo} < ${today}`,
      })
      .from(couponClaims)
      .innerJoin(coupons, eq(couponClaims.couponId, coupons.id))
      .innerJoin(stores, eq(coupons.storeId, stores.id))
      .innerJoin(users, eq(couponClaims.customerUserId, users.id))
      .where(eq(couponClaims.qrTokenHash, hashQrToken(qrToken)))
      .for("update", { of: couponClaims });
    if (!row) throw new AppError(QR_NOT_FOUND_MESSAGE, 404);
    return row;
  }

  type RedemptionRow = Awaited<ReturnType<typeof readRedemption>>;

  /**
   * The three rules a scan has to satisfy, in the order the tendero would hit
   * them. Ownership first, so a token of another store never reaches a message
   * that describes stored state. Each rejection conflicts with STORED state
   * rather than being a malformed request, so each one is a 409 — the same
   * reading T4 and T5 applied, which also keeps the expired answer identical to
   * the one the customer already gets when re-issuing a QR.
   */
  function assertRedeemable(row: RedemptionRow, tenderoUserId: string) {
    if (row.storeOwnerUserId !== tenderoUserId) {
      throw new AppError(QR_NOT_FOUND_MESSAGE, 404);
    }
    if (row.claim.status === "redeemed") {
      throw new AppError(ALREADY_REDEEMED_MESSAGE, 409);
    }
    // Before the validity check, because the release is the more specific fact
    // about this claim: the customer handed it back, whatever the window says.
    if (row.claim.releasedOn !== null) {
      throw new AppError(RELEASED_MESSAGE, 409);
    }
    if (row.expired) {
      throw new AppError(NO_LONGER_VALID_MESSAGE, 409);
    }
    // A paused coupon and a deactivated store are deliberately NOT checked:
    // both block NEW claims only, and a claim already made stays redeemable up
    // to the validity end date (S6, L6, L11).
  }

  /**
   * One record shape for the preview and for the redemption, so the dry run can
   * never describe the coupon differently from the real thing. The claim state
   * is passed in because it is the ONE field that differs: the stored row for a
   * preview, the updated row for a redemption.
   */
  const redemptionRecord = (
    row: RedemptionRow,
    claim: { status: typeof couponClaims.$inferSelect.status; redeemedOn: string | null },
  ): CouponRedemptionRecord => ({
    claimId: row.claim.id,
    status: claim.status,
    redeemedOn: claim.redeemedOn,
    // The first name only; the full name never leaves this layer.
    customerName: customerDisplayName(row.customerFullName),
    coupon: mapCoupon(row.coupon),
    store: { id: row.storeId, name: row.storeName },
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

    /**
     * The claim/redemption funnel of every coupon of ONE store (S9).
     *
     * The counts come from the claim rows themselves, in one grouped query
     * rather than one query per coupon: `count(claims)` is how many customers
     * took the coupon and the `filter` is how many of those actually redeemed
     * it, so `redeemed <= claimed` holds by construction.
     *
     * A coupon with no claims still appears, with zeros — hence the LEFT join.
     * A tendero needs to see the coupon nobody took; it is the most actionable
     * row on the screen.
     *
     * An expired, unredeemed claim is counted exactly once, as a CLAIM: nothing
     * in this query looks at the validity window, because the funnel is a fact
     * about the past and the claim happened (S6, S8). It is the redemption that
     * the validity end date forbids, and a redemption that never happened
     * contributes nothing to `redeemed_count`.
     *
     * The casts to `int` are deliberate: `count()` is `bigint` and the driver
     * would otherwise hand it back as a string.
     */
    async listMetricsByStoreId(
      storeId: string,
    ): Promise<CouponMetricsRecord[]> {
      return (
        await db
          .select({
            couponId: coupons.id,
            title: coupons.title,
            type: coupons.type,
            totalStock: coupons.totalStock,
            reservedCount: coupons.claimedCount,
            // A RELEASED claim is not a claim this coupon still holds (C4):
            // the customer gave it back and the reservation went with it, so
            // it is filtered out of the funnel instead of inflating it. It can
            // never reach `redeemed_count` either, because
            // `coupon_claims_release_chk` forbids a released claim from being
            // redeemed at all.
            claimedCount: sql<number>`count(${couponClaims.id}) filter (where ${couponClaims.releasedOn} is null)::int`,
            redeemedCount: sql<number>`count(${couponClaims.id}) filter (where ${couponClaims.status} = 'redeemed')::int`,
          })
          .from(coupons)
          .leftJoin(couponClaims, eq(couponClaims.couponId, coupons.id))
          .where(eq(coupons.storeId, storeId))
          // Grouping by the primary key is what lets the other coupon columns
          // travel ungrouped.
          .groupBy(coupons.id)
          // Newest coupon first, matching the tendero's own coupon list.
          // `created_at` is internal and is never rendered (S11).
          .orderBy(desc(coupons.createdAt))
      );
    },

    /**
     * One page of a store's redemption history, newest first (S9).
     *
     * Ordering: the display date descending, then the claim's internal
     * `created_at` and finally its id. The tiebreaker is needed because
     * `redeemed_on` is a DATE and nothing finer is stored — S11 keeps clock
     * times out of the product, so several redemptions on one day are
     * genuinely undated relative to each other. The fallback is deterministic
     * and total, so paging never shows one entry twice or skips one, even
     * though it orders same-day redemptions by when the CLAIM was made rather
     * than by when the scan happened.
     *
     * `hasMore` comes from reading one row past the limit instead of from a
     * `count(*)` over the whole history, which would grow with the store.
     *
     * The full name is turned into the first name here, so it never leaves this
     * layer (see `coupons/customer-name.ts`).
     */
    async listRedemptionHistoryByStoreId(
      storeId: string,
      page: { limit: number; offset: number },
    ): Promise<{ entries: CouponRedemptionEntryRecord[]; hasMore: boolean }> {
      const rows = await db
        .select({
          claimId: couponClaims.id,
          couponTitle: coupons.title,
          customerFullName: users.fullName,
          redeemedOn: couponClaims.redeemedOn,
        })
        .from(couponClaims)
        .innerJoin(coupons, eq(couponClaims.couponId, coupons.id))
        .innerJoin(users, eq(couponClaims.customerUserId, users.id))
        .where(
          and(
            eq(coupons.storeId, storeId),
            eq(couponClaims.status, "redeemed"),
          ),
        )
        .orderBy(
          desc(couponClaims.redeemedOn),
          desc(couponClaims.createdAt),
          desc(couponClaims.id),
        )
        .limit(page.limit + 1)
        .offset(page.offset);

      return {
        entries: rows.slice(0, page.limit).map((row) => {
          // `coupon_claims_redemption_chk` forces a redeemed claim to carry its
          // date, and only redeemed claims are read, so this is unreachable —
          // it is here because the column is nullable in general.
          if (row.redeemedOn === null) {
            throw new AppError("A redeemed claim has no date.", 502);
          }
          return {
            claimId: row.claimId,
            couponTitle: row.couponTitle,
            customerName: customerDisplayName(row.customerFullName),
            redeemedOn: row.redeemedOn,
          };
        }),
        hasMore: rows.length > page.limit,
      };
    },

    /**
     * The claimable coupons of a set of stores, with whether THIS customer
     * already claimed each one (S7).
     *
     * “Claimable” is the four conditions S7 names, all evaluated in the
     * database: not paused, the coupon calendar day inside the validity window
     * (inclusive at both ends, per S6), and stock left. The store filter is the
     * caller's, because the feed's store set is the union of “within 3 km” and
     * “followed”, which only the route knows.
     */
    async listClaimableForCustomer(
      storeIds: string[],
      customerUserId: string,
    ): Promise<ClaimableCouponRecord[]> {
      if (!storeIds.length) return [];
      const today = couponCalendarToday();

      const rows = await db
        .select({
          coupon: coupons,
          claimed: sql<boolean>`${couponClaims.id} is not null`,
        })
        .from(coupons)
        .leftJoin(
          couponClaims,
          and(
            eq(couponClaims.couponId, coupons.id),
            eq(couponClaims.customerUserId, customerUserId),
          ),
        )
        .where(
          and(
            inArray(coupons.storeId, storeIds),
            eq(coupons.paused, false),
            sql`${coupons.validFrom} <= ${today} and ${today} <= ${coupons.validTo}`,
            sql`${coupons.claimedCount} < ${coupons.totalStock}`,
          ),
        )
        // Newest first within one store; the route's stable sort by distance
        // then keeps this as the tie-break, and `created_at` is never rendered.
        .orderBy(desc(coupons.createdAt));

      return rows.map((row) => ({
        ...mapCoupon(row.coupon),
        claimed: row.claimed,
      }));
    },

    /**
     * Claims a coupon for a customer in ONE transaction (S6, S8).
     *
     * The reservation is a conditional increment — `set claimed_count =
     * claimed_count + 1 where claimed_count < total_stock` — so the row lock
     * serialises concurrent claims and the loser's WHERE is re-evaluated
     * against the committed value and matches nothing. No read-then-write
     * comparison is involved, which is why overselling is impossible rather
     * than unlikely, and `coupons_claimed_within_stock_chk` stands behind it as
     * the invariant no statement can bypass.
     *
     * The claim row goes in after the increment, so the UNIQUE on
     * (coupon, customer) aborts the whole transaction and the reservation is
     * rolled back with it: a rejected claim always leaves stock unchanged.
     *
     * Returns the plaintext token, which exists only here and in the response
     * that carries it: the database keeps only its hash (S3).
     */
    async claimForCustomer(
      couponId: string,
      customerUserId: string,
    ): Promise<{ claimId: string; qrToken: string }> {
      return mappingConstraints(() =>
        db.transaction(async (tx) => {
          const today = couponCalendarToday();
          const [row] = await tx
            .select({
              coupon: coupons,
              storeActive: stores.active,
              withinValidity: sql<boolean>`${coupons.validFrom} <= ${today} and ${today} <= ${coupons.validTo}`,
            })
            .from(coupons)
            .innerJoin(stores, eq(coupons.storeId, stores.id))
            .where(eq(coupons.id, couponId));
          if (!row) throw new AppError("Coupon not found.", 404);

          // Each rejection conflicts with STORED state rather than being a
          // malformed request, so each one is a 409 with its own reason.
          //
          // The store comes first, because it is the outer context: a
          // deactivated store blocks NEW claims exactly the way a paused coupon
          // does, and the claims already made stay redeemable until the
          // validity end date (L11). Discovery already hides an inactive
          // store's coupons (S7); this is the direct-id path behind it.
          if (!row.storeActive) {
            throw new AppError(
              "This store is deactivated and is not accepting new claims.",
              409,
            );
          }
          if (row.coupon.paused) {
            throw new AppError(
              "This coupon is paused and is not accepting new claims.",
              409,
            );
          }
          if (!row.withinValidity) {
            throw new AppError("This coupon is not valid today.", 409);
          }

          /**
           * The customer's own precondition (C2): the tendero's counter
           * confirms the person in front of them against `customerName`, which
           * is derived from this column, so a claim nobody can be named for
           * would hand the scanner an empty confirmation.
           *
           * Emptiness is tested the way `customerDisplayName` reads the column
           * — no non-whitespace character — because `PATCH /auth/me` accepts a
           * whitespace-only name and its validation belongs to the tendero's
           * frozen auth flow.
           */
          const [customer] = await tx
            .select({ fullName: users.fullName })
            .from(users)
            .where(eq(users.id, customerUserId));
          if (!customerDisplayName(customer?.fullName ?? "")) {
            throw new AppError(NAME_REQUIRED_MESSAGE, 409);
          }

          const [existing] = await tx
            .select({
              id: couponClaims.id,
              releasedOn: couponClaims.releasedOn,
            })
            .from(couponClaims)
            .where(
              and(
                eq(couponClaims.couponId, couponId),
                eq(couponClaims.customerUserId, customerUserId),
              ),
            );
          if (existing) {
            // Once per customer survives a release (C4): the row is still
            // there, so the refusal says which of the two states it is in.
            throw new AppError(
              existing.releasedOn === null
                ? "You have already claimed this coupon."
                : ALREADY_RELEASED_CLAIM_MESSAGE,
              409,
            );
          }

          const reserved = await tx
            .update(coupons)
            .set({
              claimedCount: sql`${coupons.claimedCount} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(coupons.id, couponId),
                sql`${coupons.claimedCount} < ${coupons.totalStock}`,
              ),
            )
            .returning({ id: coupons.id });
          if (!reserved.length) {
            throw new AppError("This coupon is out of stock.", 409);
          }

          const qrToken = createQrToken();
          const [claim] = await tx
            .insert(couponClaims)
            .values({
              couponId,
              customerUserId,
              qrTokenHash: hashQrToken(qrToken),
              // Explicit, not the column default: the default is
              // `current_date`, which is the UTC day, and the claim was just
              // validated against the coupon calendar day.
              claimedOn: today,
            })
            .returning({ id: couponClaims.id });
          if (!claim) throw new AppError("Unable to create the claim.", 502);

          return { claimId: claim.id, qrToken };
        }),
      );
    },

    /**
     * Releases one of the customer's own claims (C4) and returns the reserved
     * unit to stock exactly once.
     *
     * ONE transaction, and the claim row is locked for its whole length with
     * `for update of coupon_claims` — only the claim, not the coupon and not
     * the store, which other requests keep writing. That lock is what makes a
     * release and a REDEMPTION serialise: `readRedemption` takes the same one.
     *
     * Exactly-once is two mechanisms deep, the same shape the redemption uses:
     * the claim UPDATE carries `status = 'claimed' and released_on is null` in
     * its WHERE, so a second release matches zero rows instead of marking the
     * claim again, and the decrement only runs when that UPDATE actually
     * changed a row. `claimed_count > 0` guards the decrement itself, so
     * `coupons_claimed_within_stock_chk` can never be the thing that notices.
     *
     * The row is deliberately KEPT: `UNIQUE(coupon_id, customer_user_id)` still
     * says this customer took this coupon once (S6), so the re-claim is a 409
     * rather than a second claim.
     */
    async releaseClaimForCustomer(
      claimId: string,
      customerUserId: string,
    ): Promise<{ claimId: string }> {
      return mappingConstraints(() =>
        db.transaction(async (tx) => {
          const today = couponCalendarToday();
          const [row] = await tx
            .select({
              claim: couponClaims,
              couponId: coupons.id,
              expired: sql<boolean>`${coupons.validTo} < ${today}`,
            })
            .from(couponClaims)
            .innerJoin(coupons, eq(couponClaims.couponId, coupons.id))
            .where(eq(couponClaims.id, claimId))
            .for("update", { of: couponClaims });
          if (!row) throw new AppError("Claim not found.", 404);
          if (row.claim.customerUserId !== customerUserId) {
            throw new AppError("This claim belongs to another customer.", 403);
          }
          if (row.claim.status === "redeemed") {
            throw new AppError("This claim has already been redeemed.", 409);
          }
          if (row.claim.releasedOn !== null) {
            throw new AppError(ALREADY_RELEASED_MESSAGE, 409);
          }
          // An expired claim has nothing to give back: the validity end date
          // already took it out of circulation (S6), and the unit it reserved
          // can no longer be claimed by anyone.
          if (row.expired) {
            throw new AppError(NO_LONGER_VALID_MESSAGE, 409);
          }

          const released = await tx
            .update(couponClaims)
            .set({ releasedOn: today })
            .where(
              and(
                eq(couponClaims.id, claimId),
                eq(couponClaims.status, "claimed"),
                isNull(couponClaims.releasedOn),
              ),
            )
            .returning({ id: couponClaims.id });
          if (!released.length) {
            throw new AppError(ALREADY_RELEASED_MESSAGE, 409);
          }

          const restored = await tx
            .update(coupons)
            .set({
              claimedCount: sql`${coupons.claimedCount} - 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(coupons.id, row.couponId),
                sql`${coupons.claimedCount} > 0`,
              ),
            )
            .returning({ id: coupons.id });
          if (!restored.length) {
            // Unreachable: this claim held the reservation the WHERE above
            // just proved was still unreleased. Rolling back is the only
            // honest answer if the counter ever disagrees.
            throw new AppError("Unable to release the claim.", 502);
          }

          return { claimId };
        }),
      );
    },

    /**
     * Issues a NEW token for a claim and forgets the old one.
     *
     * Only the hash is stored, so a customer who lost the plaintext cannot be
     * given it back — re-issuing is the only recovery, and overwriting the hash
     * is what invalidates whatever was shown before.
     *
     * A claim that belongs to someone else is a 403 and not a 404, the same
     * reading the tendero coupon routes use: the id came from somewhere.
     */
    async rotateClaimQrTokenForCustomer(
      claimId: string,
      customerUserId: string,
    ): Promise<{ claimId: string; qrToken: string }> {
      const today = couponCalendarToday();
      const [row] = await db
        .select({
          claim: couponClaims,
          expired: sql<boolean>`${coupons.validTo} < ${today}`,
        })
        .from(couponClaims)
        .innerJoin(coupons, eq(couponClaims.couponId, coupons.id))
        .where(eq(couponClaims.id, claimId));
      if (!row) throw new AppError("Claim not found.", 404);
      if (row.claim.customerUserId !== customerUserId) {
        throw new AppError("This claim belongs to another customer.", 403);
      }
      if (row.claim.status === "redeemed") {
        throw new AppError("This claim has already been redeemed.", 409);
      }
      // A released claim has no QR to re-issue: the customer gave it back (C4).
      if (row.claim.releasedOn !== null) {
        throw new AppError(RELEASED_MESSAGE, 409);
      }
      if (row.expired) {
        throw new AppError(NO_LONGER_VALID_MESSAGE, 409);
      }

      const qrToken = createQrToken();
      // The status and the release are both part of the WHERE, so a redemption
      // or a release that commits between the read above and this write loses
      // the race instead of reviving a dead claim with a fresh token.
      const rotated = await db
        .update(couponClaims)
        .set({ qrTokenHash: hashQrToken(qrToken) })
        .where(
          and(
            eq(couponClaims.id, claimId),
            eq(couponClaims.status, "claimed"),
            isNull(couponClaims.releasedOn),
          ),
        )
        .returning({ id: couponClaims.id });
      if (!rotated.length) {
        // Which of the two won the race decides the message, so the loser is
        // never told the wrong story about its own claim.
        const [latest] = await db
          .select({ releasedOn: couponClaims.releasedOn })
          .from(couponClaims)
          .where(eq(couponClaims.id, claimId));
        throw new AppError(
          latest?.releasedOn === null || latest === undefined
            ? "This claim has already been redeemed."
            : RELEASED_MESSAGE,
          409,
        );
      }

      return { claimId, qrToken };
    },

    /**
     * A customer's claims, each with its coupon and the store to redeem it at,
     * for the wallet and for the single-claim responses.
     *
     * The customer id is a filter and not a check, so this can never read
     * another customer's claim. `expired` comes from the same query as the rest
     * (S6: the validity end date is the hard limit), so the derived status
     * never disagrees with the window the claim path validated against.
     */
    async listClaimDetailsForCustomer(
      customerUserId: string,
      claimId?: string,
    ): Promise<CustomerClaimRecord[]> {
      const today = couponCalendarToday();
      const rows = await db
        .select({
          claim: couponClaims,
          coupon: coupons,
          storeId: stores.id,
          storeName: stores.name,
          expired: sql<boolean>`${coupons.validTo} < ${today}`,
        })
        .from(couponClaims)
        .innerJoin(coupons, eq(couponClaims.couponId, coupons.id))
        .innerJoin(stores, eq(coupons.storeId, stores.id))
        .where(
          and(
            eq(couponClaims.customerUserId, customerUserId),
            ...(claimId === undefined
              ? []
              : [eq(couponClaims.id, claimId)]),
          ),
        )
        // Most recent claim first. `created_at` is the internal instant and is
        // never rendered; the displayed date is `claimed_on` (S11).
        .orderBy(desc(couponClaims.createdAt));

      return rows.map((row) => ({
        id: row.claim.id,
        status: row.claim.status,
        claimedOn: row.claim.claimedOn,
        redeemedOn: row.claim.redeemedOn,
        expired: row.expired,
        // The date itself stays in the database: the wallet needs the FACT
        // that the claim was released, and no screen renders a new date (S11).
        released: row.claim.releasedOn !== null,
        coupon: mapCoupon(row.coupon),
        store: { id: row.storeId, name: row.storeName },
      }));
    },

    /**
     * What a scan WOULD redeem, without redeeming it (S3).
     *
     * It exists for the scanner's own UX: the camera fires the moment a QR is
     * in frame, and the tendero should see which coupon and which customer that
     * was before committing the one-way transition. It therefore applies
     * exactly the same rules as the redemption below and differs in one thing
     * only — it writes nothing, so the claim it reports is still `claimed`.
     */
    async previewRedemptionByQrToken(
      qrToken: string,
      tenderoUserId: string,
    ): Promise<CouponRedemptionRecord> {
      return db.transaction(async (tx) => {
        const row = await readRedemption(tx, qrToken);
        assertRedeemable(row, tenderoUserId);
        return redemptionRecord(row, row.claim);
      });
    },

    /**
     * Redeems the claim behind a scanned QR, exactly once (S3, S8).
     *
     * ONE transaction: the claim row is locked while ownership, the stored
     * status and the validity are checked, and the transition itself carries
     * `status = 'claimed'` in its WHERE — the same technique the QR re-issue
     * uses. So even if the lock were lost, a second redemption would match zero
     * rows instead of overwriting the first one's date and tendero.
     *
     * Claiming already reserved the stock, so NOTHING here touches
     * `claimed_count` (S8); the counter is the reservation, not the redemption.
     *
     * `redeemed_on` is written from the coupon calendar day, not from the
     * column's `current_date` default, for the reason `calendar.ts` records:
     * after 19:00 local the UTC day is already tomorrow, and the date the
     * tendero sees must be the day they actually scanned.
     */
    async redeemByQrToken(
      qrToken: string,
      tenderoUserId: string,
    ): Promise<CouponRedemptionRecord> {
      return mappingConstraints(() =>
        db.transaction(async (tx) => {
          const row = await readRedemption(tx, qrToken);
          assertRedeemable(row, tenderoUserId);

          const [redeemed] = await tx
            .update(couponClaims)
            .set({
              status: "redeemed",
              redeemedOn: couponCalendarToday(),
              redeemedByUserId: tenderoUserId,
            })
            .where(
              and(
                eq(couponClaims.id, row.claim.id),
                eq(couponClaims.status, "claimed"),
              ),
            )
            .returning({
              status: couponClaims.status,
              redeemedOn: couponClaims.redeemedOn,
            });
          if (!redeemed) {
            throw new AppError(ALREADY_REDEEMED_MESSAGE, 409);
          }

          return redemptionRecord(row, redeemed);
        }),
      );
    },
  };
}
