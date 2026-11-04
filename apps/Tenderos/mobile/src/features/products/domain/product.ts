import type { CatalogObservedPrice } from "@repo/api-contracts/catalog";

/**
 * One row of the store's catalog as every product screen reads it: the shared
 * catalog assignments and the store-private products flattened into ONE shape,
 * so the workspace list, the product detail and the Perfil tab cannot disagree
 * about what a product is.
 *
 * It lived inside `ProductCard.tsx` until this unit; the detail screen needs
 * the same shape, and a type that two screens read belongs beside the rule
 * that builds it rather than inside one of the two components.
 *
 * There is NO image field and there never will be one in this MVP (S10, L9):
 * a product is drawn as the icon of its category.
 */
export type ProductSaleUnit = "unidad" | "kg" | "g" | "L" | "ml";

export type Product = {
  id: string;
  name: string;
  /** The category NAME, already worded: `Sin categoría` when there is none. */
  category: string;
  /**
   * The catalog slug rebuilt from the RAW category name, or null when the
   * product has no category at all. It is what the pastel tile and the icon
   * are chosen from — never the id (S11), never the worded label.
   */
  categoryKey: string | null;
  /** Carried for completeness and NEVER rendered (S11). */
  categoryId: string | null;
  brand: string;
  presentation: string;
  price: number | null;
  observedPrice: CatalogObservedPrice | null;
  stock: number;
  active: boolean;
  saleUnit: ProductSaleUnit;
  integerOnly: boolean;
  source: "shared" | "private";
  pricePending?: boolean;
};

/** The wording for a product the tendero has not priced yet. */
export const NO_PRICE_LABEL = "Sin precio";
/** The wording for a category the tendero never set. */
export const NO_CATEGORY_LABEL = "Sin categoría";

export function productPriceLabel(price: number | null | undefined): string {
  if (price === null || price === undefined || price <= 0)
    return NO_PRICE_LABEL;
  return `$${price.toFixed(2)}`;
}

/**
 * Stock as a sentence rather than a bare number: zero is the state the tendero
 * has to act on, so it is a word and not a `0`.
 */
export function productStockLabel(stock: number): string {
  if (stock <= 0) return "Agotado";
  // `kg`/`L` products carry fractional stock; a trailing `.000` is noise.
  const amount = Number.isInteger(stock) ? String(stock) : String(Number(stock.toFixed(3)));
  return `${amount} en stock`;
}

/** Where the row came from, said in the tendero's own language. */
export function productSourceLabel(source: Product["source"]): string {
  return source === "shared" ? "Catálogo compartido" : "Producto propio";
}
