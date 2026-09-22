import { z } from "zod";

export type CatalogCurrency = "USD";

/**
 * Canonical catalog request contract. The legacy Product model and order
 * migration are intentionally outside this contract.
 */
export const catalogCurrencySchema = z.literal("USD");
export const catalogProductIdSchema = z.uuid();
export const catalogPriceSchema = z.number().nonnegative().nullable();
export const catalogStockSchema = z.int().nonnegative();

export const catalogStoreProductAddSchema = z.strictObject({
  productId: catalogProductIdSchema,
  price: catalogPriceSchema.optional(),
});

export const catalogStoreProductUpdateSchema = z
  .strictObject({
    price: catalogPriceSchema.optional(),
    stock: catalogStockSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (payload) => Object.values(payload).some((value) => value !== undefined),
    {
      message: "At least one catalog store product field is required.",
    },
  );

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
