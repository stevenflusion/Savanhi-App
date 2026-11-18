import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const REGISTRATION_STATUSES = [
  "profile_required",
  "store_required",
  "completed",
] as const;

export const registrationStatusEnum = pgEnum(
  "registration_status",
  REGISTRATION_STATUSES,
);

export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  roleId: uuid("role_id")
    .references(() => roles.id)
    .notNull(),
  email: text("email").notNull().unique(),
  emailNormalized: text("email_normalized").notNull().unique(),
  passwordHash: text("password_hash"),
  fullName: text("full_name").notNull(),
  // Date-only (S11) and nullable: only a customer fills it (C8), and every
  // user created before it existed simply has none — it is never backfilled.
  birthDate: date("birth_date", { mode: "string" }),
  active: boolean("active").default(true).notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  registrationStatus: registrationStatusEnum("registration_status")
    .default("profile_required")
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    refreshTokenHash: text("refresh_token_hash").unique(),
    familyId: uuid("family_id").notNull(),
    rotation: integer("rotation").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIndex: index("auth_sessions_user_idx").on(table.userId),
    familyIndex: index("auth_sessions_family_idx").on(table.familyId),
    expiryIndex: index("auth_sessions_expiry_idx").on(table.expiresAt),
  }),
);

/**
 * The device a customer session receives push reminders on. It is bound to a
 * refresh-token FAMILY, not to a rotating access token: refresh keeps the
 * family, so the registration survives rotation, while sign-out or revocation
 * of the family leaves a sender with no live session to send to.
 *
 * Invariants: one owner per Expo token (`expo_token` unique) and one token per
 * session family (`family_id` unique). `family_id` has no foreign key because
 * `auth_sessions.family_id` is not unique (one row per rotation).
 */
export const customerPushDevices = pgTable(
  "customer_push_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    familyId: uuid("family_id").notNull(),
    expoToken: text("expo_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tokenIndex: uniqueIndex("customer_push_devices_token_uidx").on(
      table.expoToken,
    ),
    familyIndex: uniqueIndex("customer_push_devices_family_uidx").on(
      table.familyId,
    ),
    userIndex: index("customer_push_devices_user_idx").on(table.userId),
  }),
);

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    emailNormalized: text("email_normalized").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    emailIndex: index("otp_challenges_email_idx").on(table.emailNormalized),
    expiryIndex: index("otp_challenges_expiry_idx").on(table.expiresAt),
    activeEmailIndex: uniqueIndex("otp_challenges_active_email_uidx")
      .on(table.emailNormalized)
      .where(sql`${table.consumedAt} is null and ${table.lockedAt} is null`),
  }),
);

export const otpRequestLeases = pgTable(
  "otp_request_leases",
  {
    emailNormalized: text("email_normalized").primaryKey(),
    leaseToken: uuid("lease_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    expiryIndex: index("otp_request_leases_expiry_idx").on(table.expiresAt),
  }),
);

export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    action: text("action").notNull(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    count: integer("count").default(0).notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    bucketIndex: uniqueIndex("auth_rate_limits_bucket_uidx").on(
      table.action,
      table.scope,
      table.key,
    ),
    resetIndex: index("auth_rate_limits_reset_idx").on(table.resetAt),
  }),
);

export const authEvents = pgTable(
  "auth_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: text("event_type").notNull(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sessionId: uuid("session_id").references(() => authSessions.id, {
      onDelete: "set null",
    }),
    familyId: uuid("family_id"),
    emailHash: text("email_hash"),
    outcome: text("outcome").notNull(),
    reason: text("reason"),
    requestId: text("request_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    typeIndex: index("auth_events_type_idx").on(table.eventType),
    userIndex: index("auth_events_user_idx").on(table.userId),
    createdIndex: index("auth_events_created_idx").on(table.createdAt),
  }),
);

export const register = pgTable("register", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const login = pgTable("login", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
/**
 * Frozen, database-only table. The application no longer reads or writes it,
 * but the definition is retained so drizzle-kit never generates a drop for the
 * existing table and its rows. Not to be confused with `catalogBrands`, which
 * the global product catalog depends on.
 */
export const brands = pgTable("brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  ownerUserId: uuid("owner_user_id").references(() => users.id),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const stores = pgTable("stores", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id")
    .references(() => users.id)
    .notNull(),
  name: text("name").notNull(),
  address: text("address"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  paymentMethod: text("payment_method"),
  bankAccountName: text("bank_account_name"),
  bankAccountNumber: text("bank_account_number"),
  bankAccountType: text("bank_account_type"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id").references(() => stores.id),
    // Frozen, database-only column kept out of every application read and
    // write path; retained so drizzle-kit never generates a drop for it.
    brandId: uuid("brand_id").references(() => brands.id),
    name: text("name").notNull(),
    description: text("description"),
    price: numeric("price", { precision: 12, scale: 2 }),
    stock: numeric("stock", { precision: 12, scale: 3 })
      .$type<number>()
      .default(1)
      .notNull(),
    saleUnit: text("sale_unit").default("unidad").notNull(),
    integerOnly: boolean("integer_only").default(false).notNull(),
    categoryId: uuid("category_id").references(() => catalogCategories.id),
    storeCategoryId: uuid("store_category_id").references(
      () => storeProductCategories.id,
    ),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    priceActiveCheck: check(
      "products_active_price_positive_chk",
      sql`${table.price} is not null and ${table.price} > 0 or not ${table.active}`,
    ),
    stockCheck: check(
      "products_stock_nonnegative_chk",
      sql`${table.stock} >= 0`,
    ),
    saleUnitCheck: check(
      "products_sale_unit_chk",
      sql`${table.saleUnit} in ('unidad', 'kg', 'g', 'L', 'ml')`,
    ),
    integerStockCheck: check(
      "products_integer_stock_chk",
      sql`(${table.saleUnit} <> 'unidad' and not ${table.integerOnly}) or ${table.stock} = trunc(${table.stock})`,
    ),
  }),
);

export const catalogCategories = pgTable(
  "catalog_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    slugIndex: uniqueIndex("catalog_categories_slug_uidx").on(table.slug),
  }),
);

export const catalogBrands = pgTable(
  "catalog_brands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    nameIndex: uniqueIndex("catalog_brands_name_uidx").on(table.name),
  }),
);

export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    categoryId: uuid("category_id")
      .references(() => catalogCategories.id)
      .notNull(),
    brandId: uuid("brand_id")
      .references(() => catalogBrands.id)
      .notNull(),
    commercialName: text("commercial_name").notNull(),
    description: text("description"),
    variant: text("variant"),
    presentation: text("presentation"),
    unitsPerPackage: integer("units_per_package"),
    netContent: numeric("net_content", { precision: 12, scale: 3 }),
    netContentUnit: text("net_content_unit"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    brandNameIndex: index("catalog_products_brand_name_idx").on(
      table.brandId,
      table.commercialName,
    ),
    unitsCheck: check(
      "catalog_products_units_positive_chk",
      sql`${table.unitsPerPackage} is null or ${table.unitsPerPackage} > 0`,
    ),
    contentCheck: check(
      "catalog_products_content_positive_chk",
      sql`${table.netContent} is null or ${table.netContent} > 0`,
    ),
  }),
);

export const catalogProductIdentifiers = pgTable(
  "catalog_product_identifiers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .references(() => catalogProducts.id, { onDelete: "cascade" })
      .notNull(),
    kind: text("kind").notNull(),
    value: text("value"),
    source: text("source"),
    verified: boolean("verified").default(false).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    productIndex: index("catalog_product_identifiers_product_idx").on(
      table.productId,
    ),
    productKindIndex: uniqueIndex(
      "catalog_product_identifiers_product_kind_uidx",
    ).on(table.productId, table.kind),
    valueIndex: uniqueIndex("catalog_product_identifiers_value_uidx").on(
      table.kind,
      table.value,
    ),
  }),
);

export const catalogObservedPrices = pgTable(
  "catalog_observed_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .references(() => catalogProducts.id, { onDelete: "cascade" })
      .notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    currency: text("currency").default("USD").notNull(),
    city: text("city").notNull(),
    source: text("source").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    verified: boolean("verified").default(false).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    productDateIndex: index("catalog_observed_prices_product_date_idx").on(
      table.productId,
      table.observedAt,
    ),
    snapshotIndex: uniqueIndex("catalog_observed_prices_snapshot_uidx").on(
      table.productId,
      table.source,
      table.observedAt,
    ),
  }),
);

export const storeCatalogProducts = pgTable(
  "store_catalog_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .references(() => stores.id, { onDelete: "cascade" })
      .notNull(),
    productId: uuid("product_id")
      .references(() => catalogProducts.id, { onDelete: "cascade" })
      .notNull(),
    price: numeric("price", { precision: 12, scale: 2 }),
    currency: text("currency").default("USD").notNull(),
    stock: numeric("stock", { precision: 12, scale: 3 }).default("1").notNull(),
    saleUnit: text("sale_unit").default("unidad").notNull(),
    integerOnly: boolean("integer_only").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    storeProductIndex: uniqueIndex(
      "store_catalog_products_store_product_uidx",
    ).on(table.storeId, table.productId),
    storeIndex: index("store_catalog_products_store_idx").on(table.storeId),
    stockCheck: check(
      "store_catalog_products_stock_nonnegative_chk",
      sql`${table.stock} >= 0`,
    ),
    saleUnitCheck: check(
      "store_catalog_products_sale_unit_chk",
      sql`${table.saleUnit} in ('unidad', 'kg', 'g', 'L', 'ml')`,
    ),
    integerStockCheck: check(
      "store_catalog_products_integer_stock_chk",
      sql`(${table.saleUnit} <> 'unidad' and not ${table.integerOnly}) or ${table.stock} = trunc(${table.stock})`,
    ),
    priceCheck: check(
      "store_catalog_products_price_nonnegative_chk",
      sql`${table.price} is not null and ${table.price} > 0 or not ${table.active}`,
    ),
  }),
);

/**
 * Object references for a store's photos. The bytes live in Garage; only the
 * generated object key is persisted, so the public URL strategy can change
 * without a migration.
 */
export const storePhotos = pgTable(
  "store_photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .references(() => stores.id, { onDelete: "cascade" })
      .notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    storeIndex: index("store_photos_store_idx").on(table.storeId),
    objectKeyIndex: uniqueIndex("store_photos_object_key_uidx").on(
      table.objectKey,
    ),
    contentTypeCheck: check(
      "store_photos_content_type_chk",
      sql`${table.contentType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    byteSizeCheck: check(
      "store_photos_byte_size_positive_chk",
      sql`${table.byteSize} > 0`,
    ),
    positionCheck: check(
      "store_photos_position_nonnegative_chk",
      sql`${table.position} >= 0`,
    ),
  }),
);

/**
 * The four coupon types (S4). They are declared here instead of imported from
 * `@repo/api-contracts` so drizzle-kit can load this schema without the
 * contracts package being built. `mapCoupon` assigns `coupons.type` straight
 * into the contract's `CouponType` with no cast, so adding a value here
 * without adding it there is a compile error.
 */
const COUPON_TYPES = [
  "free_text",
  "combo",
  "percentage",
  "fixed_amount",
] as const;
type CouponTypeValue = (typeof COUPON_TYPES)[number];

const COUPON_CLAIM_STATUSES = ["claimed", "redeemed"] as const;
type CouponClaimStatusValue = (typeof COUPON_CLAIM_STATUSES)[number];

/**
 * A coupon belongs to one store and carries exactly one type (S4). The type is
 * a text column with a CHECK over the closed set, matching the convention of
 * `products.sale_unit` and `store_photos.content_type`; `coupons_type_value_chk`
 * then pins which value field that type may carry and which it may not.
 *
 * `valid_from`/`valid_to` are DATE columns because coupon validity is
 * date-granular and no screen ever shows a time (S11).
 */
export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .references(() => stores.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").$type<CouponTypeValue>().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** Only a `free_text` coupon carries this. */
    freeText: text("free_text"),
    /** Only a `percentage` coupon carries this: a whole percent, 1 to 100. */
    percentageValue: integer("percentage_value"),
    /** Only a `fixed_amount` coupon carries this. */
    fixedAmountValue: numeric("fixed_amount_value", {
      precision: 12,
      scale: 2,
    }),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validTo: date("valid_to", { mode: "string" }).notNull(),
    totalStock: integer("total_stock").notNull(),
    /**
     * Claims already reserved against the stock (S8). Claiming reserves, so
     * this counter is the reservation and `coupons_claimed_within_stock_chk`
     * is what makes overselling impossible even under concurrent claims.
     */
    claimedCount: integer("claimed_count").default(0).notNull(),
    /** Pausing blocks NEW claims only; existing claims stay redeemable (S6). */
    paused: boolean("paused").default(false).notNull(),
    /** Generated under the `coupons` image scope; the bytes live in Garage. */
    imageObjectKey: text("image_object_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    storeIndex: index("coupons_store_idx").on(table.storeId),
    validityIndex: index("coupons_validity_idx").on(
      table.validFrom,
      table.validTo,
    ),
    /** Two coupons never share one object key; a missing image is not a clash. */
    objectKeyIndex: uniqueIndex("coupons_image_object_key_uidx")
      .on(table.imageObjectKey)
      .where(sql`${table.imageObjectKey} is not null`),
    typeCheck: check(
      "coupons_type_chk",
      sql`${table.type} in ('free_text', 'combo', 'percentage', 'fixed_amount')`,
    ),
    /**
     * Each type carries exactly what it needs and nothing else (S4). Every
     * clause is an implication, so an unrecognised type leaves this check
     * vacuously true and only `coupons_type_chk` reports the violation.
     */
    typeValueCheck: check(
      "coupons_type_value_chk",
      sql`(${table.type} <> 'free_text' or (${table.freeText} is not null and ${table.percentageValue} is null and ${table.fixedAmountValue} is null))
        and (${table.type} <> 'percentage' or (${table.percentageValue} is not null and ${table.freeText} is null and ${table.fixedAmountValue} is null))
        and (${table.type} <> 'fixed_amount' or (${table.fixedAmountValue} is not null and ${table.freeText} is null and ${table.percentageValue} is null))
        and (${table.type} <> 'combo' or (${table.freeText} is null and ${table.percentageValue} is null and ${table.fixedAmountValue} is null))`,
    ),
    percentageRangeCheck: check(
      "coupons_percentage_range_chk",
      sql`${table.percentageValue} is null or (${table.percentageValue} >= 1 and ${table.percentageValue} <= 100)`,
    ),
    fixedAmountCheck: check(
      "coupons_fixed_amount_positive_chk",
      sql`${table.fixedAmountValue} is null or ${table.fixedAmountValue} > 0`,
    ),
    validityOrderCheck: check(
      "coupons_validity_order_chk",
      sql`${table.validFrom} <= ${table.validTo}`,
    ),
    totalStockCheck: check(
      "coupons_total_stock_nonnegative_chk",
      sql`${table.totalStock} >= 0`,
    ),
    /**
     * `greatest` keeps this check from also firing on a negative total stock,
     * which `coupons_total_stock_nonnegative_chk` owns, so a rejected write
     * always names exactly one constraint.
     */
    claimedCountCheck: check(
      "coupons_claimed_within_stock_chk",
      sql`${table.claimedCount} >= 0 and ${table.claimedCount} <= greatest(${table.totalStock}, 0)`,
    ),
  }),
);

/**
 * The products a coupon applies to (S5). A coupon holds one row per product, so
 * a `2x1 / combo` coupon can reference two or more.
 *
 * The two product models the codebase already has stay distinguishable: a row
 * points either at a global-catalog assignment (`store_catalog_products`) or at
 * a store-private product (`products`), never at both and never at neither.
 * Both references RESTRICT on delete, because a cascade could leave a coupon
 * with zero products, the one state S5 forbids. Neither table is hard-deleted
 * today — the catalog and product repositories only flip `active`.
 */
export const couponProducts = pgTable(
  "coupon_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    couponId: uuid("coupon_id")
      .references(() => coupons.id, { onDelete: "cascade" })
      .notNull(),
    storeCatalogProductId: uuid("store_catalog_product_id").references(
      () => storeCatalogProducts.id,
      { onDelete: "restrict" },
    ),
    storeProductId: uuid("store_product_id").references(() => products.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    /**
     * One row per coupon+product. Two unique indexes instead of one because a
     * row leaves the other source null, and a null never collides in a
     * Postgres unique index — which is exactly the wanted behaviour.
     */
    couponCatalogIndex: uniqueIndex(
      "coupon_products_coupon_catalog_uidx",
    ).on(table.couponId, table.storeCatalogProductId),
    couponPrivateIndex: uniqueIndex("coupon_products_coupon_private_uidx").on(
      table.couponId,
      table.storeProductId,
    ),
    singleSourceCheck: check(
      "coupon_products_single_source_chk",
      sql`num_nonnulls(${table.storeCatalogProductId}, ${table.storeProductId}) = 1`,
    ),
  }),
);

/**
 * A customer's claim on a coupon. Claiming reserves stock and redemption comes
 * later, in the store (S8), so a claim starts as `claimed` and moves once to
 * `redeemed`.
 *
 * `qr_token_hash` stores only the SHA-256 of the opaque high-entropy token the
 * customer renders as a QR (S3). The decision follows what this codebase
 * already does with bearer secrets — `auth_sessions.token_hash` and
 * `otp_challenges.code_hash` — so a database dump never yields a redeemable
 * QR. The consequence is deliberate: the plaintext token exists only in the
 * response that issues it, and a customer who loses it gets a NEW token
 * written over this hash rather than the old one read back.
 *
 * `claimed_on`/`redeemed_on` are the dates a human sees (S11) and `created_at`
 * is the internal instant used for ordering and never rendered. The display
 * date is its own column because the local calendar day of an event is not
 * derivable from a UTC instant without a zone.
 */
export const couponClaims = pgTable(
  "coupon_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    couponId: uuid("coupon_id")
      .references(() => coupons.id, { onDelete: "cascade" })
      .notNull(),
    customerUserId: uuid("customer_user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    status: text("status")
      .$type<CouponClaimStatusValue>()
      .default("claimed")
      .notNull(),
    qrTokenHash: text("qr_token_hash").notNull(),
    claimedOn: date("claimed_on", { mode: "string" })
      .default(sql`current_date`)
      .notNull(),
    redeemedOn: date("redeemed_on", { mode: "string" }),
    /**
     * The day the customer gave the coupon back (C4). Nullable, and it is the
     * WHOLE representation of a released claim: `status` keeps its two stored
     * values, so `coupon_claims_status_chk` is untouched and no migration has
     * to remove anything. "Released" is therefore derived on read, exactly as
     * "expired" is.
     *
     * The row survives on purpose — `UNIQUE(coupon_id, customer_user_id)` still
     * says this customer took this coupon once (S6) — while the reservation it
     * held is returned to `coupons.claimed_count`.
     */
    releasedOn: date("released_on", { mode: "string" }),
    /** The tendero who scanned the QR. */
    redeemedByUserId: uuid("redeemed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    /**
     * Once per customer (S6). This index also serves "claims by coupon",
     * because `coupon_id` is its leading column.
     */
    couponCustomerIndex: uniqueIndex(
      "coupon_claims_coupon_customer_uidx",
    ).on(table.couponId, table.customerUserId),
    qrTokenIndex: uniqueIndex("coupon_claims_qr_token_hash_uidx").on(
      table.qrTokenHash,
    ),
    customerIndex: index("coupon_claims_customer_idx").on(
      table.customerUserId,
    ),
    statusCheck: check(
      "coupon_claims_status_chk",
      sql`${table.status} in ('claimed', 'redeemed')`,
    ),
    /**
     * A redeemed claim always records when and by whom; an unredeemed one
     * records neither. Written as a disjunction over `status = 'redeemed'` so
     * an unrecognised status leaves this check satisfied and only
     * `coupon_claims_status_chk` reports the violation.
     */
    redemptionCheck: check(
      "coupon_claims_redemption_chk",
      sql`(${table.status} = 'redeemed' and ${table.redeemedOn} is not null and ${table.redeemedByUserId} is not null)
        or (${table.status} <> 'redeemed' and ${table.redeemedOn} is null and ${table.redeemedByUserId} is null)`,
    ),
    /**
     * A released claim can never be redeemed and a redeemed claim can never be
     * released (C4). The route layer answers both with their own 409 before a
     * statement runs; this is the invariant no statement can bypass, in the
     * same spirit as `coupons_claimed_within_stock_chk`.
     */
    releaseCheck: check(
      "coupon_claims_release_chk",
      sql`${table.releasedOn} is null or ${table.status} <> 'redeemed'`,
    ),
  }),
);

/**
 * A customer follows a store (S7). Follow and unfollow are idempotent, which
 * the unique pair below is what makes safe.
 */
export const storeFollows = pgTable(
  "store_follows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerUserId: uuid("customer_user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    storeId: uuid("store_id")
      .references(() => stores.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    /** Also serves "follows by customer", its leading column. */
    customerStoreIndex: uniqueIndex("store_follows_customer_store_uidx").on(
      table.customerUserId,
      table.storeId,
    ),
    /** Follower counts and the followed flag of the feed read by store. */
    storeIndex: index("store_follows_store_idx").on(table.storeId),
  }),
);

export const storeProductCategories = pgTable(
  "store_product_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .references(() => stores.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    nameIndex: uniqueIndex("store_product_categories_store_name_uidx").on(
      table.storeId,
      table.name,
    ),
  }),
);
export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientUserId: uuid("client_user_id").references(() => users.id),
  storeId: uuid("store_id").references(() => stores.id),
  status: text("status").default("pending").notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).default("0").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .references(() => orders.id, { onDelete: "cascade" })
    .notNull(),
  productId: uuid("product_id").references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
});
export const deliveries = pgTable("deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").references(() => orders.id),
  deliveryUserId: uuid("delivery_user_id").references(() => users.id),
  status: text("status").default("assigned").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const schema = {
  roles,
  users,
  authSessions,
  customerPushDevices,
  otpChallenges,
  otpRequestLeases,
  authRateLimits,
  authEvents,
  register,
  login,
  brands,
  stores,
  products,
  catalogCategories,
  catalogBrands,
  catalogProducts,
  catalogProductIdentifiers,
  catalogObservedPrices,
  storeCatalogProducts,
  storePhotos,
  storeProductCategories,
  coupons,
  couponProducts,
  couponClaims,
  storeFollows,
  orders,
  orderItems,
  deliveries,
};
