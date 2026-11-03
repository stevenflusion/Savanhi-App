import type { ComponentProps } from "react";
import type MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { CouponProductCategory } from "@repo/api-contracts";

/**
 * S10 — a product is drawn as the icon of its CATEGORY. There are no product
 * images and no illustration dependency: `@expo/vector-icons` is already
 * installed and MaterialCommunityIcons already ships everything this mapping
 * needs.
 *
 * The icon is chosen from the category's stable `key` — the catalog category
 * slug — and NEVER from an id (S11).
 */
export type CategoryIconName = ComponentProps<
  typeof MaterialCommunityIcons
>["name"];

/**
 * Keyed by the catalog category slugs as they are actually seeded in
 * `packages/backend-core/src/scripts/seed.ts`. A slug that is not here yet
 * falls back rather than being guessed from the category name, which is free
 * text in the store-authored case.
 */
export const CATEGORY_ICON_BY_KEY: Record<string, CategoryIconName> = {
  "bebidas-gaseosas": "bottle-soda-classic",
  lacteos: "cheese",
  despensa: "food-variant",
  confiteria: "candy-outline",
  "higiene-del-hogar": "spray-bottle",
};

/**
 * The answer for a product with no category, with a store-authored category
 * (whose name is free text the tendero typed, so it has no slug), or with a
 * catalog slug this mapping does not cover yet.
 */
export const DEFAULT_CATEGORY_ICON: CategoryIconName = "package-variant-closed";

export function categoryIconFor(
  category: CouponProductCategory | null | undefined,
): CategoryIconName {
  if (!category?.key) return DEFAULT_CATEGORY_ICON;
  return CATEGORY_ICON_BY_KEY[category.key] ?? DEFAULT_CATEGORY_ICON;
}
