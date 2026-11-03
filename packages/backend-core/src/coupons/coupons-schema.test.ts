import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray, like, sql } from "drizzle-orm";
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from "../database/connection.js";
import {
  catalogBrands,
  catalogCategories,
  catalogProducts,
  couponClaims,
  couponProducts,
  coupons,
  products,
  roles,
  storeCatalogProducts,
  storeFollows,
  stores,
  users,
} from "../database/schema.js";
import type { BackendEnv } from "../types/env.js";

const env: BackendEnv = {
  serviceName: "coupons-schema-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "coupons-schema-tests",
  authJwtAudience: "savanhi-api",
  trustProxy: false,
  otpProvider: "development",
  otpDevCode: "123456",
  rateLimits: { api: 10_000, otpRequest: 10_000, otpVerify: 10_000, refresh: 10_000 },
};

const db = createDatabaseConnection(env);

type Tx = Parameters<Parameters<DatabaseConnection["transaction"]>[0]>[0];

/** Thrown to roll back a probe; it is never a real failure. */
class Rollback extends Error {}

/**
 * Runs one probe inside a transaction that is ALWAYS rolled back, and returns
 * the probe's rejection or `undefined`. Nothing a constraint test inserts
 * survives, so the suite never leaves a coupon, claim or follow behind, and a
 * statement that aborts the transaction cannot poison the next probe.
 */
async function probe(
  run: (tx: Tx) => Promise<unknown>,
): Promise<unknown | undefined> {
  let captured: unknown;
  try {
    await db.transaction(async (tx) => {
      captured = await run(tx).then(
        () => undefined,
        (error: unknown) => error,
      );
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return captured;
}

/**
 * Drizzle wraps a failed statement in a query error and keeps the `pg` error,
 * which is the one carrying `constraint`, on the cause chain.
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

async function expectViolation(
  constraint: string,
  run: (tx: Tx) => Promise<unknown>,
) {
  const error = await probe(run);
  assert.ok(
    error instanceof Error,
    `the write succeeded; ${constraint} never fired`,
  );
  assert.equal(
    violatedConstraint(error),
    constraint,
    `expected ${constraint} but got: ${error.message}`,
  );
}

async function expectAccepted(run: (tx: Tx) => Promise<unknown>) {
  const error = await probe(run);
  assert.equal(
    error,
    undefined,
    error instanceof Error ? error.message : String(error),
  );
}

async function databaseIsReachable() {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/** An opaque QR token is never stored in the clear; only its hash is. */
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/**
 * Everything this suite inserts carries this prefix, so the purge below also
 * clears a fixture left behind by a run that crashed before its teardown. It
 * runs before AND after the suite, which is what keeps the dev database clean
 * without the teardown having to survive every possible failure.
 */
const FIXTURE_PREFIX = "Coupon fixture";
const FIXTURE_EMAIL_PATTERN = "coupon-%@savanhi.test";
const FIXTURE_SLUG_PATTERN = "coupon-fixture-%";

async function purgeFixtures() {
  const storeIds = (
    await db
      .select({ id: stores.id })
      .from(stores)
      .where(like(stores.name, `${FIXTURE_PREFIX} store%`))
  ).map((row) => row.id);
  const userIds = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, FIXTURE_EMAIL_PATTERN))
  ).map((row) => row.id);

  if (userIds.length > 0) {
    await db
      .delete(storeFollows)
      .where(inArray(storeFollows.customerUserId, userIds));
  }
  if (storeIds.length > 0) {
    // `coupons` cascades to `coupon_products` and `coupon_claims`, and those
    // hold the RESTRICT references, so coupons go before any product row.
    await db.delete(coupons).where(inArray(coupons.storeId, storeIds));
    await db
      .delete(storeFollows)
      .where(inArray(storeFollows.storeId, storeIds));
    // `products` has no cascade from `stores`, so it goes before the store.
    await db.delete(products).where(inArray(products.storeId, storeIds));
    await db
      .delete(storeCatalogProducts)
      .where(inArray(storeCatalogProducts.storeId, storeIds));
    await db.delete(stores).where(inArray(stores.id, storeIds));
  }
  await db
    .delete(catalogProducts)
    .where(like(catalogProducts.commercialName, `${FIXTURE_PREFIX} product%`));
  await db
    .delete(catalogBrands)
    .where(like(catalogBrands.name, `${FIXTURE_PREFIX} brand%`));
  await db
    .delete(catalogCategories)
    .where(like(catalogCategories.slug, FIXTURE_SLUG_PATTERN));
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
}

async function createFixture() {
  await db.insert(roles).values({ name: "tendero" }).onConflictDoNothing();
  await db.insert(roles).values({ name: "client" }).onConflictDoNothing();
  const roleRows = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(inArray(roles.name, ["tendero", "client"]));
  const tenderoRoleId = roleRows.find((row) => row.name === "tendero")?.id;
  const clientRoleId = roleRows.find((row) => row.name === "client")?.id;
  assert.ok(tenderoRoleId && clientRoleId, "the base roles must exist");

  const tag = randomUUID();
  const [owner] = await db
    .insert(users)
    .values({
      roleId: tenderoRoleId,
      email: `coupon-owner-${tag}@savanhi.test`,
      emailNormalized: `coupon-owner-${tag}@savanhi.test`,
      fullName: "Coupon fixture owner",
    })
    .returning({ id: users.id });
  const [customer] = await db
    .insert(users)
    .values({
      roleId: clientRoleId,
      email: `coupon-customer-${tag}@savanhi.test`,
      emailNormalized: `coupon-customer-${tag}@savanhi.test`,
      fullName: "Coupon fixture customer",
    })
    .returning({ id: users.id });
  const [otherCustomer] = await db
    .insert(users)
    .values({
      roleId: clientRoleId,
      email: `coupon-customer2-${tag}@savanhi.test`,
      emailNormalized: `coupon-customer2-${tag}@savanhi.test`,
      fullName: "Coupon fixture second customer",
    })
    .returning({ id: users.id });
  assert.ok(owner && customer && otherCustomer);

  const [store] = await db
    .insert(stores)
    .values({ ownerUserId: owner.id, name: `${FIXTURE_PREFIX} store ${tag}` })
    .returning({ id: stores.id });
  assert.ok(store);

  const [category] = await db
    .insert(catalogCategories)
    .values({ name: `${FIXTURE_PREFIX} category ${tag}`, slug: `coupon-fixture-${tag}` })
    .returning({ id: catalogCategories.id });
  const [brand] = await db
    .insert(catalogBrands)
    .values({ name: `${FIXTURE_PREFIX} brand ${tag}` })
    .returning({ id: catalogBrands.id });
  assert.ok(category && brand);

  const catalogProductRows = await db
    .insert(catalogProducts)
    .values([
      {
        categoryId: category.id,
        brandId: brand.id,
        commercialName: `${FIXTURE_PREFIX} product ${tag}`,
      },
      {
        categoryId: category.id,
        brandId: brand.id,
        commercialName: `${FIXTURE_PREFIX} product 2 ${tag}`,
      },
    ])
    .returning({ id: catalogProducts.id });
  const [catalogProduct, secondCatalogProduct] = catalogProductRows;
  assert.ok(catalogProduct && secondCatalogProduct);

  const assignmentRows = await db
    .insert(storeCatalogProducts)
    .values([
      { storeId: store.id, productId: catalogProduct.id, price: "1.50" },
      { storeId: store.id, productId: secondCatalogProduct.id, price: "2.75" },
    ])
    .returning({ id: storeCatalogProducts.id });
  const [assignment, secondAssignment] = assignmentRows;
  assert.ok(assignment && secondAssignment);

  const [privateProduct] = await db
    .insert(products)
    .values({
      storeId: store.id,
      name: `${FIXTURE_PREFIX} private product ${tag}`,
      price: "2.25",
    })
    .returning({ id: products.id });
  const [secondPrivateProduct] = await db
    .insert(products)
    .values({
      storeId: store.id,
      name: `${FIXTURE_PREFIX} private product 2 ${tag}`,
      price: "3.00",
    })
    .returning({ id: products.id });
  assert.ok(privateProduct && secondPrivateProduct);

  return {
    ownerId: owner.id,
    customerId: customer.id,
    otherCustomerId: otherCustomer.id,
    storeId: store.id,
    assignmentId: assignment.id,
    secondAssignmentId: secondAssignment.id,
    privateProductId: privateProduct.id,
    secondPrivateProductId: secondPrivateProduct.id,
  };
}

test("the coupon tables constrain every rule the product requires", async (t) => {
  if (!(await databaseIsReachable())) {
    await db.pool.end();
    t.skip(
      `Postgres is not reachable at ${env.databaseUrl}. Run "docker compose up -d postgres && pnpm --filter @repo/backend-core db:migrate".`,
    );
    return;
  }

  t.after(async () => {
    await purgeFixtures();
    await db.pool.end();
  });
  await purgeFixtures();
  const fixture = await createFixture();

  /** A valid `combo` coupon; every probe starts from a row that is accepted. */
  const baseCoupon = {
    storeId: fixture.storeId,
    type: "combo" as const,
    title: "Promo de noviembre",
    validFrom: "2026-11-01",
    validTo: "2026-11-30",
    totalStock: 5,
  };

  async function insertCoupon(tx: Tx, overrides: Record<string, unknown> = {}) {
    const [row] = await tx
      .insert(coupons)
      .values({ ...baseCoupon, ...overrides } as typeof coupons.$inferInsert)
      .returning({ id: coupons.id });
    assert.ok(row);
    return row.id;
  }

  await t.test("the coupon type is a closed set of exactly four values", async () => {
    for (const type of ["free_text", "combo", "percentage", "fixed_amount"]) {
      await expectAccepted((tx) =>
        insertCoupon(tx, {
          type,
          freeText: type === "free_text" ? "Lleva una funda gratis" : null,
          percentageValue: type === "percentage" ? 20 : null,
          fixedAmountValue: type === "fixed_amount" ? "1.50" : null,
        }),
      );
    }
    for (const type of ["buy_one_get_one", "2x1", "", "FREE_TEXT"]) {
      await expectViolation("coupons_type_chk", (tx) =>
        insertCoupon(tx, { type }),
      );
    }
  });

  await t.test("each coupon type carries exactly the value it needs", async () => {
    // A type that needs a value cannot be stored without it...
    await expectViolation("coupons_type_value_chk", (tx) =>
      insertCoupon(tx, { type: "free_text" }),
    );
    await expectViolation("coupons_type_value_chk", (tx) =>
      insertCoupon(tx, { type: "percentage" }),
    );
    await expectViolation("coupons_type_value_chk", (tx) =>
      insertCoupon(tx, { type: "fixed_amount" }),
    );
    // ...and no type may carry another type's value.
    await expectViolation("coupons_type_value_chk", (tx) =>
      insertCoupon(tx, { type: "combo", freeText: "Lleva una funda gratis" }),
    );
    await expectViolation("coupons_type_value_chk", (tx) =>
      insertCoupon(tx, { type: "combo", percentageValue: 20 }),
    );
    await expectViolation("coupons_type_value_chk", (tx) =>
      insertCoupon(tx, { type: "combo", fixedAmountValue: "1.50" }),
    );
    await expectViolation("coupons_type_value_chk", (tx) =>
      insertCoupon(tx, { type: "percentage", percentageValue: 20, freeText: "x" }),
    );
    await expectViolation("coupons_type_value_chk", (tx) =>
      insertCoupon(tx, {
        type: "free_text",
        freeText: "Lleva una funda gratis",
        fixedAmountValue: "1.50",
      }),
    );
  });

  await t.test("a percentage is a whole percent between 1 and 100", async () => {
    for (const percentageValue of [1, 20, 100]) {
      await expectAccepted((tx) =>
        insertCoupon(tx, { type: "percentage", percentageValue }),
      );
    }
    for (const percentageValue of [0, -5, 101]) {
      await expectViolation("coupons_percentage_range_chk", (tx) =>
        insertCoupon(tx, { type: "percentage", percentageValue }),
      );
    }
  });

  await t.test("a fixed amount is strictly positive", async () => {
    await expectAccepted((tx) =>
      insertCoupon(tx, { type: "fixed_amount", fixedAmountValue: "0.01" }),
    );
    for (const fixedAmountValue of ["0", "-1.00"]) {
      await expectViolation("coupons_fixed_amount_positive_chk", (tx) =>
        insertCoupon(tx, { type: "fixed_amount", fixedAmountValue }),
      );
    }
  });

  await t.test("the validity starts on or before it ends", async () => {
    await expectAccepted((tx) =>
      insertCoupon(tx, { validFrom: "2026-11-05", validTo: "2026-11-05" }),
    );
    await expectViolation("coupons_validity_order_chk", (tx) =>
      insertCoupon(tx, { validFrom: "2026-11-30", validTo: "2026-11-01" }),
    );
  });

  await t.test("the total stock is a nonnegative count", async () => {
    await expectAccepted((tx) => insertCoupon(tx, { totalStock: 0 }));
    await expectViolation("coupons_total_stock_nonnegative_chk", (tx) =>
      insertCoupon(tx, { totalStock: -1 }),
    );
  });

  await t.test("the claimed counter can never oversell the stock", async () => {
    // S8 — claiming reserves stock, so the counter is the reservation and the
    // database refuses to let it pass the total.
    await expectAccepted((tx) =>
      insertCoupon(tx, { totalStock: 5, claimedCount: 5 }),
    );
    await expectViolation("coupons_claimed_within_stock_chk", (tx) =>
      insertCoupon(tx, { totalStock: 5, claimedCount: 6 }),
    );
    await expectViolation("coupons_claimed_within_stock_chk", (tx) =>
      insertCoupon(tx, { totalStock: 5, claimedCount: -1 }),
    );
    await expectViolation("coupons_claimed_within_stock_chk", async (tx) => {
      const couponId = await insertCoupon(tx, { totalStock: 1 });
      return tx
        .update(coupons)
        .set({ claimedCount: 2 })
        .where(eq(coupons.id, couponId));
    });
  });

  await t.test("a coupon image object key belongs to one coupon only", async () => {
    const objectKey = `coupons/${randomUUID()}/${randomUUID()}.jpg`;
    await expectAccepted((tx) => insertCoupon(tx, { imageObjectKey: objectKey }));
    // Two coupons without an image are fine; the uniqueness is partial.
    await expectAccepted(async (tx) => {
      await insertCoupon(tx);
      return insertCoupon(tx);
    });
    await expectViolation("coupons_image_object_key_uidx", async (tx) => {
      await insertCoupon(tx, { imageObjectKey: objectKey });
      return insertCoupon(tx, { imageObjectKey: objectKey });
    });
  });

  await t.test(
    "a coupon product reference names exactly one product source",
    async () => {
      await expectAccepted(async (tx) => {
        const couponId = await insertCoupon(tx);
        return tx.insert(couponProducts).values([
          { couponId, storeCatalogProductId: fixture.assignmentId },
          { couponId, storeProductId: fixture.privateProductId },
        ]);
      });
      await expectViolation("coupon_products_single_source_chk", async (tx) => {
        const couponId = await insertCoupon(tx);
        return tx.insert(couponProducts).values({ couponId });
      });
      await expectViolation("coupon_products_single_source_chk", async (tx) => {
        const couponId = await insertCoupon(tx);
        return tx.insert(couponProducts).values({
          couponId,
          storeCatalogProductId: fixture.assignmentId,
          storeProductId: fixture.privateProductId,
        });
      });
    },
  );

  await t.test("one coupon never references the same product twice", async () => {
    await expectViolation(
      "coupon_products_coupon_catalog_uidx",
      async (tx) => {
        const couponId = await insertCoupon(tx);
        return tx.insert(couponProducts).values([
          { couponId, storeCatalogProductId: fixture.assignmentId },
          { couponId, storeCatalogProductId: fixture.assignmentId },
        ]);
      },
    );
    await expectViolation("coupon_products_coupon_private_uidx", async (tx) => {
      const couponId = await insertCoupon(tx);
      return tx.insert(couponProducts).values([
        { couponId, storeProductId: fixture.privateProductId },
        { couponId, storeProductId: fixture.privateProductId },
      ]);
    });
    // Two different private products are two rows whose catalog column is
    // null, and a null never collides in a Postgres unique index.
    await expectAccepted(async (tx) => {
      const couponId = await insertCoupon(tx);
      return tx.insert(couponProducts).values([
        { couponId, storeProductId: fixture.privateProductId },
        { couponId, storeProductId: fixture.secondPrivateProductId },
      ]);
    });
    // A combo across the two product models and both sources at once.
    await expectAccepted(async (tx) => {
      const couponId = await insertCoupon(tx);
      return tx.insert(couponProducts).values([
        { couponId, storeCatalogProductId: fixture.assignmentId },
        { couponId, storeCatalogProductId: fixture.secondAssignmentId },
        { couponId, storeProductId: fixture.privateProductId },
      ]);
    });
    // The same product on two different coupons is fine.
    await expectAccepted(async (tx) => {
      const first = await insertCoupon(tx);
      const second = await insertCoupon(tx);
      return tx.insert(couponProducts).values([
        { couponId: first, storeCatalogProductId: fixture.assignmentId },
        { couponId: second, storeCatalogProductId: fixture.assignmentId },
      ]);
    });
  });

  await t.test("a claim is either claimed or redeemed, consistently", async () => {
    await expectAccepted(async (tx) => {
      const couponId = await insertCoupon(tx);
      return tx.insert(couponClaims).values({
        couponId,
        customerUserId: fixture.customerId,
        qrTokenHash: hashToken(randomUUID()),
      });
    });
    await expectAccepted(async (tx) => {
      const couponId = await insertCoupon(tx);
      return tx.insert(couponClaims).values({
        couponId,
        customerUserId: fixture.customerId,
        qrTokenHash: hashToken(randomUUID()),
        status: "redeemed",
        redeemedOn: "2026-11-10",
        redeemedByUserId: fixture.ownerId,
      });
    });
    await expectViolation("coupon_claims_status_chk", async (tx) => {
      const couponId = await insertCoupon(tx);
      return tx.insert(couponClaims).values({
        couponId,
        customerUserId: fixture.customerId,
        qrTokenHash: hashToken(randomUUID()),
        status: "cancelled" as "claimed",
      });
    });
    // A redeemed claim always says when, and an unredeemed one never does.
    await expectViolation("coupon_claims_redemption_chk", async (tx) => {
      const couponId = await insertCoupon(tx);
      return tx.insert(couponClaims).values({
        couponId,
        customerUserId: fixture.customerId,
        qrTokenHash: hashToken(randomUUID()),
        status: "redeemed",
      });
    });
    await expectViolation("coupon_claims_redemption_chk", async (tx) => {
      const couponId = await insertCoupon(tx);
      return tx.insert(couponClaims).values({
        couponId,
        customerUserId: fixture.customerId,
        qrTokenHash: hashToken(randomUUID()),
        redeemedOn: "2026-11-10",
      });
    });
    await expectViolation("coupon_claims_redemption_chk", async (tx) => {
      const couponId = await insertCoupon(tx);
      return tx.insert(couponClaims).values({
        couponId,
        customerUserId: fixture.customerId,
        qrTokenHash: hashToken(randomUUID()),
        redeemedByUserId: fixture.ownerId,
      });
    });
  });

  await t.test("a coupon is claimed at most once per customer", async () => {
    // S6 — "una vez por cliente", enforced by the database and not only by a
    // read-then-write check in the application.
    await expectViolation(
      "coupon_claims_coupon_customer_uidx",
      async (tx) => {
        const couponId = await insertCoupon(tx);
        return tx.insert(couponClaims).values([
          {
            couponId,
            customerUserId: fixture.customerId,
            qrTokenHash: hashToken(randomUUID()),
          },
          {
            couponId,
            customerUserId: fixture.customerId,
            qrTokenHash: hashToken(randomUUID()),
          },
        ]);
      },
    );
    await expectAccepted(async (tx) => {
      const couponId = await insertCoupon(tx);
      return tx.insert(couponClaims).values([
        {
          couponId,
          customerUserId: fixture.customerId,
          qrTokenHash: hashToken(randomUUID()),
        },
        {
          couponId,
          customerUserId: fixture.otherCustomerId,
          qrTokenHash: hashToken(randomUUID()),
        },
      ]);
    });
  });

  await t.test("a QR token hash identifies one claim globally", async () => {
    const qrTokenHash = hashToken(randomUUID());
    await expectViolation("coupon_claims_qr_token_hash_uidx", async (tx) => {
      const couponId = await insertCoupon(tx);
      return tx.insert(couponClaims).values([
        { couponId, customerUserId: fixture.customerId, qrTokenHash },
        { couponId, customerUserId: fixture.otherCustomerId, qrTokenHash },
      ]);
    });
  });

  await t.test("a customer follows a store at most once", async () => {
    await expectViolation("store_follows_customer_store_uidx", (tx) =>
      tx.insert(storeFollows).values([
        { customerUserId: fixture.customerId, storeId: fixture.storeId },
        { customerUserId: fixture.customerId, storeId: fixture.storeId },
      ]),
    );
    await expectAccepted((tx) =>
      tx.insert(storeFollows).values([
        { customerUserId: fixture.customerId, storeId: fixture.storeId },
        { customerUserId: fixture.otherCustomerId, storeId: fixture.storeId },
      ]),
    );
  });
});
