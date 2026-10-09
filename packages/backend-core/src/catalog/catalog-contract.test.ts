import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  catalogCurrencySchema,
  catalogStoreProductAddSchema,
  catalogStoreProductUpdateSchema,
} from "@repo/api-contracts/catalog";

test("catalog add contract requires a UUID product ID and positive price", () => {
  assert.equal(
    catalogStoreProductAddSchema.safeParse({
      productId: randomUUID(),
      price: 1.25,
      saleUnit: "unidad",
      integerOnly: true,
    }).success,
    true,
  );
  assert.equal(
    catalogStoreProductAddSchema.safeParse({ productId: "product-1" }).success,
    false,
  );
  assert.equal(
    catalogStoreProductAddSchema.safeParse({
      productId: randomUUID(),
      price: 0,
      saleUnit: "unidad",
      integerOnly: true,
    }).success,
    false,
  );
});

test("catalog assignment requires a positive USD price and explicit sale rules", () => {
  const productId = randomUUID();
  assert.equal(
    catalogStoreProductAddSchema.safeParse({
      productId,
      price: 1.15,
      saleUnit: "kg",
      integerOnly: false,
    }).success,
    true,
  );
  for (const price of [undefined, null, 0, -1, 1.234]) {
    assert.equal(
      catalogStoreProductAddSchema.safeParse({
        productId,
        price,
        saleUnit: "unidad",
        integerOnly: true,
      }).success,
      false,
    );
  }
});

test("sale stock accepts whole units and three-decimal fractional units only", () => {
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({ stock: 1 }).success,
    true,
  );
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({ stock: 0.125 }).success,
    true,
  );
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({ stock: 0.1234 }).success,
    false,
  );
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({
      saleUnit: "unidad",
      stock: 1.5,
    }).success,
    false,
  );
});

test("catalog update contract accepts nonnegative three-decimal stock and positive prices", () => {
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({ stock: 0, price: 1 }).success,
    true,
  );
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({ stock: -1 }).success,
    false,
  );
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({ stock: 0.125 }).success,
    true,
  );
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({ price: 0 }).success,
    false,
  );
});

test("catalog request contracts reject empty updates and unknown fields", () => {
  assert.equal(catalogStoreProductUpdateSchema.safeParse({}).success, false);
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({ active: true, ignored: true })
      .success,
    false,
  );
  assert.equal(
    catalogStoreProductAddSchema.safeParse({
      productId: randomUUID(),
      ignored: true,
    }).success,
    false,
  );
  assert.equal(catalogCurrencySchema.safeParse("USD").success, true);
  assert.equal(catalogCurrencySchema.safeParse("EUR").success, false);
});
