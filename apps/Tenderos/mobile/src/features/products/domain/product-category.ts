import {
  categoryColorFor,
  type CategoryColor,
} from "@/src/features/coupons/domain/category-colors";
import {
  categoryIconFor,
  type CategoryIconName,
} from "@/src/features/coupons/domain/category-icons";

/**
 * How a PRODUCT is painted: the same pastel and the same category icon its
 * coupons already use (S10, S14).
 *
 * A product has no image anywhere in the MVP (L9), so the tile IS the product
 * as far as the tendero sees it. The problem this module solves is that no
 * route the mobile app can reach carries the category SLUG for a product:
 * `CatalogProduct` exposes `categoryId` and `categoryName` and nothing else,
 * and the store-private rows carry the same pair — T8 recorded that as a
 * backend limit and this task may not change the backend.
 *
 * So the slug is REBUILT from the name with the same rule
 * `packages/backend-core/src/scripts/seed.ts` uses to mint it, which makes
 * every seeded catalog category land on its real key and therefore on exactly
 * the colour and icon a coupon over that product already shows. The
 * alternative — passing a null key — paints every product in the store the
 * same neutral grey, which is honest and useless.
 *
 * The deliberate consequence: a STORE-AUTHORED category (free text the tendero
 * typed) is coloured from its name too, so renaming it can repaint the tile.
 * That is a visible effect of a deliberate rename rather than a drift, and it
 * is still never an id (S11) and never a random seed.
 */

/**
 * The catalog slug for a category name, or null when there is no name.
 *
 * The seed's rule, reproduced: lowercase, accents stripped, every run of
 * non-alphanumeric characters collapsed to one hyphen, no leading or trailing
 * hyphen. `Lácteos` → `lacteos`, `Higiene del hogar` → `higiene-del-hogar`.
 *
 * It takes the RAW category name off the API and never a display label: a
 * product with no category reaches the screens worded as `Sin categoría`, and
 * slugifying that wording would give "no category" a pastel of its own.
 */
export function categorySlugFromName(
  name: string | null | undefined,
): string | null {
  if (!name) return null;

  const slug = name
    .normalize("NFD")
    // Combining marks, so `á` becomes `a` instead of being dropped.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || null;
}

/**
 * Both mappings take the SLUG and nothing else, which is what makes it
 * impossible for an id to decide how a product looks (S11). The coupon
 * mappings are the single source of truth for the table and the fallback; the
 * `name` handed to them is only carried through and is never read by either.
 */
const asCouponCategory = (key: string | null | undefined) =>
  key ? { id: "", name: "", key } : null;

export function productCategoryIcon(
  key: string | null | undefined,
): CategoryIconName {
  return categoryIconFor(asCouponCategory(key));
}

export function productCategoryColor(
  key: string | null | undefined,
): CategoryColor {
  return categoryColorFor(asCouponCategory(key));
}
