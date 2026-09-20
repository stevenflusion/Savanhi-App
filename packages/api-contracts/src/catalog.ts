export type CatalogCurrency = "USD";

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

export type CatalogStoreProductRequest = {
  productId: string;
  price?: number | null;
};

export type CatalogStoreProductUpdateRequest = {
  price?: number | null;
  stock?: number;
  active?: boolean;
};

export type CatalogProductsResponse = {
  data: CatalogProduct[];
};

export type CatalogStoreProductsResponse = {
  data: CatalogStoreProduct[];
};
