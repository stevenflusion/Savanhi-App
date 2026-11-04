import type { CouponProductCategory } from "@repo/api-contracts";

/**
 * The pastel surface a coupon card is painted with (S14).
 *
 * It is chosen from the category's stable `key` — the catalog slug — exactly
 * as the icon is, and NEVER from an id (S11) and never from the category name,
 * which is free text in the store-authored case and would repaint a card the
 * day the tendero fixes a typo.
 *
 * The mapping is ONE table and one fallback, so the Home carousel, the coupon
 * detail and (T14) the product screens cannot paint the same category two
 * different ways.
 */
export type CategoryColor = {
  /** The card background. */
  surface: string;
  /** Text and icons drawn on that background, dark enough to stay readable. */
  ink: string;
};

/** A product with no category, with a store-authored one, or with an unknown slug. */
export const DEFAULT_CATEGORY_COLOR: CategoryColor = {
  surface: "#eef1f5",
  ink: "#1f2937",
};

/**
 * Keyed by the catalog slugs actually seeded in
 * `packages/backend-core/src/scripts/seed.ts`, the same list
 * `category-icons.ts` maps icons from.
 */
export const CATEGORY_COLOR_BY_KEY: Record<string, CategoryColor> = {
  "bebidas-gaseosas": { surface: "#d9ecf7", ink: "#17455c" },
  lacteos: { surface: "#fdf0d2", ink: "#6b4e16" },
  despensa: { surface: "#e4f0dd", ink: "#2f4a27" },
  confiteria: { surface: "#fadce6", ink: "#6d2742" },
  "higiene-del-hogar": { surface: "#e6e3f7", ink: "#3a3268" },
};

/**
 * The colours an unmapped slug falls back to, in a fixed order. A new catalog
 * category still gets a pastel instead of the neutral grey, and it gets the
 * SAME one on every render and on every device, because the index comes from
 * the slug's own characters and not from a random seed or an insertion order.
 */
export const CATEGORY_COLOR_PALETTE: CategoryColor[] = [
  { surface: "#d9ecf7", ink: "#17455c" },
  { surface: "#fdf0d2", ink: "#6b4e16" },
  { surface: "#e4f0dd", ink: "#2f4a27" },
  { surface: "#fadce6", ink: "#6d2742" },
  { surface: "#e6e3f7", ink: "#3a3268" },
  { surface: "#fde3d3", ink: "#6d3418" },
];

/** A stable non-negative hash of a slug. Deterministic, never a random seed. */
function slugIndex(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 100003;
  }
  return hash % CATEGORY_COLOR_PALETTE.length;
}

export function categoryColorFor(
  category: CouponProductCategory | null | undefined,
): CategoryColor {
  const key = category?.key;
  if (!key) return DEFAULT_CATEGORY_COLOR;
  return (
    CATEGORY_COLOR_BY_KEY[key] ??
    CATEGORY_COLOR_PALETTE[slugIndex(key)] ??
    DEFAULT_CATEGORY_COLOR
  );
}
