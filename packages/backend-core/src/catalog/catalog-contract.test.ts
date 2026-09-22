import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  catalogCurrencySchema,
  catalogStoreProductAddSchema,
  catalogStoreProductUpdateSchema,
} from "@repo/api-contracts/catalog";

test("catalog add contract requires a UUID product ID and accepts nullable prices", () => {
  assert.equal(
    catalogStoreProductAddSchema.safeParse({
      productId: randomUUID(),
      price: null,
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
      price: -0.01,
    }).success,
    false,
  );
});

test("catalog update contract accepts only non-negative integer stock and non-negative prices", () => {
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({ stock: 0, price: 0 }).success,
    true,
  );
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({ stock: -1 }).success,
    false,
  );
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({ stock: 1.5 }).success,
    false,
  );
  assert.equal(
    catalogStoreProductUpdateSchema.safeParse({ price: -0.01 }).success,
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
