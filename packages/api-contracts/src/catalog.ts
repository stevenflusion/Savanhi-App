import { z } from "zod";

export type CatalogCurrency = "USD";

/**
 * Canonical catalog request contract. The legacy Product model and order
 * migration are intentionally outside this contract.
 */
export const catalogCurrencySchema = z.literal("USD");
export const catalogProductIdSchema = z.uuid();
export const catalogSaleUnitSchema = z.enum(["unidad", "kg", "g", "L", "ml"]);
export const catalogStockSchema = z
  .number()
  .finite()
  .nonnegative()
  .refine(
    (value) => Number(value.toFixed(3)) === value,
    "Stock supports at most three decimal places.",
  );
export const catalogPriceSchema = z
  .number()
  .positive()
  .refine(
    (value) => Number(value.toFixed(2)) === value,
    "Price supports at most two decimal places.",
  );

export const catalogStoreProductAddSchema = z.strictObject({
  productId: catalogProductIdSchema,
  price: catalogPriceSchema,
  saleUnit: catalogSaleUnitSchema,
  integerOnly: z.boolean(),
});

export const catalogStoreProductUpdateSchema = z
  .strictObject({
    price: catalogPriceSchema.optional(),
    stock: catalogStockSchema.optional(),
    active: z.boolean().optional(),
    saleUnit: catalogSaleUnitSchema.optional(),
    integerOnly: z.boolean().optional(),
  })
  .refine(
    (payload) =>
      Object.values(payload).some((value) => value !== undefined) &&
      !(
        payload.stock !== undefined &&
        payload.stock % 1 !== 0 &&
        (payload.saleUnit === "unidad" || payload.integerOnly === true)
      ),
    {
      message: "At least one catalog store product field is required.",
    },
  );

const customProductFields = {
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  brandId: z.uuid().nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  price: catalogPriceSchema,
  stock: catalogStockSchema.default(1),
  saleUnit: catalogSaleUnitSchema.default("unidad"),
  integerOnly: z.boolean().default(false),
};
export const storeProductCreateSchema = z
  .strictObject(customProductFields)
  .refine(
    (payload) =>
      !(
        (payload.saleUnit === "unidad" || payload.integerOnly) &&
        !Number.isInteger(payload.stock)
      ),
    "This sale unit requires whole-number stock.",
  );
export const storeProductUpdateSchema = z
  .strictObject({
    ...customProductFields,
    active: z.boolean().optional(),
  })
  .partial()
  .refine(
    (payload) => Object.keys(payload).length > 0,
    "At least one product field is required.",
  )
  .refine(
    (payload) =>
      !(
        payload.stock !== undefined &&
        payload.stock % 1 !== 0 &&
        (payload.saleUnit === "unidad" || payload.integerOnly === true)
      ),
  );
export const storeProductCategoryCreateSchema = z.strictObject({
  name: z.string().trim().min(1),
});

export type CatalogCategory = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
};

export type CatalogBrand = {
  id: string;
  name: string;
  active: boolean;
};

export type CatalogProductIdentifier = {
  id: string;
  productId: string;
  kind: string;
  value: string | null;
  source: string | null;
  verified: boolean;
  verifiedAt: string | null;
  notes: string | null;
};

export type CatalogObservedPrice = {
  id: string;
  productId: string;
  amount: number | null;
  currency: CatalogCurrency;
  city: string;
  source: string;
  observedAt: string;
  verified: boolean;
  notes: string | null;
};

export type CatalogProduct = {
  id: string;
  categoryId: string;
  categoryName: string;
  brandId: string;
  brandName: string;
  commercialName: string;
  description: string | null;
  variant: string | null;
  presentation: string | null;
  unitsPerPackage: number | null;
  netContent: number | null;
  netContentUnit: string | null;
  identifiers: CatalogProductIdentifier[];
  observedPrices: CatalogObservedPrice[];
  active: boolean;
};

export type StoreCatalogProduct = {
  id: string;
  storeId: string;
  productId: string;
  price: number | null;
  currency: CatalogCurrency;
  stock: number;
  active: boolean;
  saleUnit: "unidad" | "kg" | "g" | "L" | "ml";
  integerOnly: boolean;
  pricePending: boolean;
};

export type CatalogStoreProduct = StoreCatalogProduct & {
  product: CatalogProduct;
};

export type CatalogStoreProductRequest = z.infer<
  typeof catalogStoreProductAddSchema
>;

export type CatalogStoreProductUpdateRequest = z.infer<
  typeof catalogStoreProductUpdateSchema
>;

export type CatalogProductsResponse = {
  data: CatalogProduct[];
};

export type CatalogStoreProductsResponse = {
  data: CatalogStoreProduct[];
};
