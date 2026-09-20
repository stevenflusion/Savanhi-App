import {
  boolean,
  check,
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
export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  storeId: uuid("store_id").references(() => stores.id),
  brandId: uuid("brand_id").references(() => brands.id),
  name: text("name").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  stock: integer("stock").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
    stock: integer("stock").default(1).notNull(),
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
    priceCheck: check(
      "store_catalog_products_price_nonnegative_chk",
      sql`${table.price} is null or ${table.price} >= 0`,
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
  orders,
  orderItems,
  deliveries,
};
