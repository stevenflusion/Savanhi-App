import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  COUPON_PRODUCT_SOURCES,
  COUPON_TYPES,
  couponCreateSchema,
  couponProductRefSchema,
  couponUpdateSchema,
  customerCoordinatesSchema,
  storeFollowSchema,
} from "@repo/api-contracts";

const catalogRef = () => ({
  source: "store_catalog" as const,
  productId: randomUUID(),
});
const privateRef = () => ({
  source: "store_private" as const,
  productId: randomUUID(),
});

const validity = { validFrom: "2026-11-01", validTo: "2026-11-30" };

/** The per-type part of a create payload, S4's "carries exactly what it needs". */
const typeFixtures = {
  free_text: { type: "free_text", freeText: "Lleva una funda gratis" },
  percentage: { type: "percentage", percentageValue: 20 },
  fixed_amount: { type: "fixed_amount", fixedAmountValue: 1.5 },
  combo: { type: "combo" },
} as const;

function createPayload(
  type: keyof typeof typeFixtures,
  overrides: Record<string, unknown> = {},
) {
  return {
    title: "Promo de noviembre",
    ...validity,
    totalStock: 50,
    products: [catalogRef()],
    ...typeFixtures[type],
    ...overrides,
  };
}

test("the coupon type is a single scalar over a closed set of exactly four values", () => {
  assert.deepEqual(
    [...COUPON_TYPES],
    ["free_text", "combo", "percentage", "fixed_amount"],
  );
  assert.equal(COUPON_TYPES.length, 4);
  assert.deepEqual([...COUPON_PRODUCT_SOURCES], [
    "store_catalog",
    "store_private",
  ]);
});

test("every coupon type has a valid create payload carrying its own value", () => {
  for (const type of ["free_text", "percentage", "fixed_amount", "combo"] as const) {
    const result = couponCreateSchema.safeParse(createPayload(type));
    assert.equal(result.success, true, `${type} should be accepted`);
  }
});

test("a coupon type rejects the value fields of another type", () => {
  // S4: percentage and fixed amount carry their value, free text carries its
  // text; nothing else travels with a type that has no use for it.
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("free_text", { percentageValue: 20 }),
    ).success,
    false,
  );
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("percentage", { freeText: "Lleva una funda gratis" }),
    ).success,
    false,
  );
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("combo", { fixedAmountValue: 1.5 }),
    ).success,
    false,
  );
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("fixed_amount", { percentageValue: 20 }),
    ).success,
    false,
  );
});

test("a coupon type is never a list, an unknown value, or missing", () => {
  for (const type of [
    ["percentage"],
    ["percentage", "combo"],
    "coupon_of_the_week",
    "",
    null,
    undefined,
    20,
  ]) {
    assert.equal(
      couponCreateSchema.safeParse(createPayload("percentage", { type }))
        .success,
      false,
      `type ${JSON.stringify(type)} should be rejected`,
    );
  }
});

test("a percentage coupon needs its value and a fixed-amount coupon needs its amount", () => {
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("percentage", { percentageValue: undefined }),
    ).success,
    false,
  );
  for (const percentageValue of [0, -5, 101, 12.5]) {
    assert.equal(
      couponCreateSchema.safeParse(createPayload("percentage", { percentageValue }))
        .success,
      false,
      `percentage ${percentageValue} should be rejected`,
    );
  }
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("fixed_amount", { fixedAmountValue: undefined }),
    ).success,
    false,
  );
  for (const fixedAmountValue of [0, -1, 1.234]) {
    assert.equal(
      couponCreateSchema.safeParse(
        createPayload("fixed_amount", { fixedAmountValue }),
      ).success,
      false,
      `amount ${fixedAmountValue} should be rejected`,
    );
  }
});

test("a free-text coupon needs non-blank text", () => {
  for (const freeText of [undefined, "", "   ", null]) {
    assert.equal(
      couponCreateSchema.safeParse(createPayload("free_text", { freeText }))
        .success,
      false,
      `free text ${JSON.stringify(freeText)} should be rejected`,
    );
  }
});

test("free text, percentage and fixed amount link exactly one product", () => {
  // S5: only `2x1 / combo` may carry more than one product reference.
  for (const type of ["free_text", "percentage", "fixed_amount"] as const) {
    assert.equal(
      couponCreateSchema.safeParse(
        createPayload(type, { products: [catalogRef()] }),
      ).success,
      true,
      `${type} with one product should be accepted`,
    );
    assert.equal(
      couponCreateSchema.safeParse(
        createPayload(type, { products: [catalogRef(), privateRef()] }),
      ).success,
      false,
      `${type} with two products should be rejected`,
    );
  }
});

test("a 2x1 / combo coupon accepts one product and accepts several", () => {
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("combo", { products: [catalogRef()] }),
    ).success,
    true,
  );
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("combo", {
        products: [catalogRef(), privateRef(), catalogRef()],
      }),
    ).success,
    true,
  );
});

test("a coupon is never created with zero product references", () => {
  for (const type of ["free_text", "percentage", "fixed_amount", "combo"] as const) {
    for (const products of [[], undefined]) {
      assert.equal(
        couponCreateSchema.safeParse(createPayload(type, { products })).success,
        false,
        `${type} with ${JSON.stringify(products)} products should be rejected`,
      );
    }
  }
});

test("duplicate product references on one coupon are rejected", () => {
  const duplicate = catalogRef();
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("combo", { products: [duplicate, duplicate] }),
    ).success,
    false,
  );
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("combo", {
        products: [duplicate, privateRef(), { ...duplicate }],
      }),
    ).success,
    false,
  );
  // The same product id under the two different sources is two products.
  const productId = randomUUID();
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("combo", {
        products: [
          { source: "store_catalog", productId },
          { source: "store_private", productId },
        ],
      }),
    ).success,
    true,
  );
});

test("a product reference keeps its source distinguishable and rejects anything else", () => {
  assert.equal(couponProductRefSchema.safeParse(catalogRef()).success, true);
  assert.equal(couponProductRefSchema.safeParse(privateRef()).success, true);
  assert.equal(
    couponProductRefSchema.safeParse({
      source: "catalog",
      productId: randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    couponProductRefSchema.safeParse({ productId: randomUUID() }).success,
    false,
  );
  assert.equal(
    couponProductRefSchema.safeParse({
      source: "store_catalog",
      productId: "product-1",
    }).success,
    false,
  );
  assert.equal(
    couponProductRefSchema.safeParse({
      source: "store_catalog",
      productId: randomUUID(),
      storeId: randomUUID(),
    }).success,
    false,
  );
});

test("validity is a date-only range with from on or before to", () => {
  // S11: coupon validity is date-granular, so no payload may carry a time.
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("percentage", {
        validFrom: "2026-11-05",
        validTo: "2026-11-05",
      }),
    ).success,
    true,
  );
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("percentage", {
        validFrom: "2026-11-30",
        validTo: "2026-11-01",
      }),
    ).success,
    false,
  );
  for (const validFrom of [
    "2026-11-01T00:00:00Z",
    "2026-11-01T00:00:00.000Z",
    "2026-11-01 00:00:00",
    "2026-11-1",
    "01/11/2026",
    "2026-13-01",
    "2026-02-30",
    "",
  ]) {
    assert.equal(
      couponCreateSchema.safeParse(createPayload("percentage", { validFrom }))
        .success,
      false,
      `validFrom ${JSON.stringify(validFrom)} should be rejected`,
    );
  }
  for (const validTo of [undefined, null, "2026-11-30T23:59:59Z"]) {
    assert.equal(
      couponCreateSchema.safeParse(createPayload("percentage", { validTo }))
        .success,
      false,
      `validTo ${JSON.stringify(validTo)} should be rejected`,
    );
  }
});

test("total stock is a nonnegative integer", () => {
  for (const totalStock of [0, 1, 500]) {
    assert.equal(
      couponCreateSchema.safeParse(createPayload("percentage", { totalStock }))
        .success,
      true,
      `stock ${totalStock} should be accepted`,
    );
  }
  for (const totalStock of [-1, -50, 1.5, Number.NaN, "10", undefined, null]) {
    assert.equal(
      couponCreateSchema.safeParse(createPayload("percentage", { totalStock }))
        .success,
      false,
      `stock ${JSON.stringify(totalStock)} should be rejected`,
    );
  }
});

test("a create payload rejects unknown fields and server-owned counters", () => {
  for (const extra of [
    { claimedCount: 0 },
    { id: randomUUID() },
    { storeId: randomUUID() },
    { createdAt: "2026-11-01" },
    { discount: 20 },
  ]) {
    assert.equal(
      couponCreateSchema.safeParse(createPayload("percentage", extra)).success,
      false,
      `unknown field ${Object.keys(extra)[0]} should be rejected`,
    );
  }
});

test("a coupon is created active and may be created paused", () => {
  const active = couponCreateSchema.parse(createPayload("percentage"));
  assert.equal(active.paused, false);
  const paused = couponCreateSchema.parse(
    createPayload("percentage", { paused: true }),
  );
  assert.equal(paused.paused, true);
});

test("an image reference follows the generated coupon object-key shape", () => {
  const couponId = randomUUID();
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("percentage", {
        imageObjectKey: `coupons/${couponId}/${randomUUID()}.jpg`,
      }),
    ).success,
    true,
  );
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("percentage", { imageObjectKey: null }),
    ).success,
    true,
  );
  assert.equal(
    couponCreateSchema.safeParse(
      createPayload("percentage", { imageObjectKey: "" }),
    ).success,
    false,
  );
});

test("an update carries its type so the cardinality rule still applies", () => {
  assert.equal(
    couponUpdateSchema.safeParse({ type: "percentage", paused: true }).success,
    true,
  );
  assert.equal(
    couponUpdateSchema.safeParse({
      type: "percentage",
      products: [catalogRef(), privateRef()],
    }).success,
    false,
  );
  assert.equal(
    couponUpdateSchema.safeParse({
      type: "combo",
      products: [catalogRef(), privateRef()],
    }).success,
    true,
  );
  const duplicate = catalogRef();
  assert.equal(
    couponUpdateSchema.safeParse({
      type: "combo",
      products: [duplicate, duplicate],
    }).success,
    false,
  );
  assert.equal(
    couponUpdateSchema.safeParse({ type: "combo", products: [] }).success,
    false,
  );
});

test("an update rejects an empty payload, an unknown field, and a bad range", () => {
  assert.equal(couponUpdateSchema.safeParse({ type: "combo" }).success, false);
  assert.equal(couponUpdateSchema.safeParse({}).success, false);
  assert.equal(
    couponUpdateSchema.safeParse({ type: "combo", claimedCount: 3 }).success,
    false,
  );
  assert.equal(
    couponUpdateSchema.safeParse({
      type: "combo",
      validFrom: "2026-11-30",
      validTo: "2026-11-01",
    }).success,
    false,
  );
  // One side of the range alone cannot be compared; the repository holds the
  // stored other side (T4).
  assert.equal(
    couponUpdateSchema.safeParse({ type: "combo", validTo: "2026-11-01" })
      .success,
    true,
  );
  assert.equal(
    couponUpdateSchema.safeParse({ type: "combo", totalStock: -1 }).success,
    false,
  );
  assert.equal(
    couponUpdateSchema.safeParse({
      type: "combo",
      validTo: "2026-11-01T00:00:00Z",
    }).success,
    false,
  );
});

test("an update never changes the coupon type's value fields across types", () => {
  assert.equal(
    couponUpdateSchema.safeParse({ type: "percentage", percentageValue: 35 })
      .success,
    true,
  );
  assert.equal(
    couponUpdateSchema.safeParse({ type: "percentage", freeText: "Gratis" })
      .success,
    false,
  );
  assert.equal(
    couponUpdateSchema.safeParse({ type: "combo", percentageValue: 35 }).success,
    false,
  );
});

test("a follow request carries a store id and nothing else", () => {
  assert.equal(
    storeFollowSchema.safeParse({ storeId: randomUUID() }).success,
    true,
  );
  assert.equal(storeFollowSchema.safeParse({ storeId: "store-1" }).success, false);
  assert.equal(storeFollowSchema.safeParse({}).success, false);
  assert.equal(
    storeFollowSchema.safeParse({
      storeId: randomUUID(),
      customerId: randomUUID(),
    }).success,
    false,
  );
});

/**
 * A coordinate arrives as a query string, and the only thing that is a
 * position is a plain decimal number. Everything else — above all a blank
 * `lat=` — must be a rejection rather than a silent 0, because 0,0 is a real
 * point in the Atlantic that the feed would happily answer from.
 */
const BLANK_OR_CLEVER_COORDINATES = [
  "",
  " ",
  "   ",
  "+",
  "-",
  "\t",
  "\n",
  " \t ",
  "0x10",
  "0X10",
  "0b11",
  "0o7",
  "1e1",
  "1E1",
  "4.6e1",
  "Infinity",
  "-Infinity",
  "NaN",
  " 4.6",
  "4.6 ",
  ".5",
  "5.",
  "4,6",
  "4.6.7",
  "++4.6",
  "4-6",
  "N4.6",
];

test("a coordinate is never a blank, a space, or a non-decimal spelling", () => {
  for (const value of BLANK_OR_CLEVER_COORDINATES) {
    const shown = JSON.stringify(value);
    assert.equal(
      customerCoordinatesSchema.safeParse({ lat: value, lng: "-74.08175" })
        .success,
      false,
      `lat ${shown}`,
    );
    assert.equal(
      customerCoordinatesSchema.safeParse({ lat: "4.60971", lng: value })
        .success,
      false,
      `lng ${shown}`,
    );
    assert.equal(
      customerCoordinatesSchema.safeParse({ lat: value, lng: value }).success,
      false,
      `both ${shown}`,
    );
  }
});

test("a real coordinate pair parses to numbers", () => {
  const parsed = customerCoordinatesSchema.parse({
    lat: "4.60971",
    lng: "-74.08175",
  });
  assert.deepEqual(parsed, { lat: 4.60971, lng: -74.08175 });
  assert.equal(typeof parsed.lat, "number");
  assert.equal(typeof parsed.lng, "number");

  // A sign, a whole number and the extremes of both ranges are all positions.
  assert.deepEqual(
    customerCoordinatesSchema.parse({ lat: "+4", lng: "0" }),
    { lat: 4, lng: 0 },
  );
  assert.deepEqual(
    customerCoordinatesSchema.parse({ lat: "-90", lng: "180" }),
    { lat: -90, lng: 180 },
  );
});

test("the coordinate ranges and the strict object still hold", () => {
  for (const pair of [
    { lat: "91", lng: "0" },
    { lat: "-91", lng: "0" },
    { lat: "0", lng: "181" },
    { lat: "0", lng: "-181" },
    { lat: "90.0001", lng: "0" },
  ]) {
    assert.equal(
      customerCoordinatesSchema.safeParse(pair).success,
      false,
      JSON.stringify(pair),
    );
  }

  assert.equal(customerCoordinatesSchema.safeParse({ lat: "4.6" }).success, false);
  assert.equal(customerCoordinatesSchema.safeParse({ lng: "4.6" }).success, false);
  assert.equal(customerCoordinatesSchema.safeParse({}).success, false);
  assert.equal(
    customerCoordinatesSchema.safeParse({
      lat: "4.60971",
      lng: "-74.08175",
      radius: "9000",
    }).success,
    false,
  );
  // Express hands back an array for a repeated parameter; that is not a point.
  assert.equal(
    customerCoordinatesSchema.safeParse({ lat: ["4.6", "5.6"], lng: "0" })
      .success,
    false,
  );
});
