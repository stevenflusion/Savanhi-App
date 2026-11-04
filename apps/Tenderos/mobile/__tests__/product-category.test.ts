import {
  CATEGORY_COLOR_BY_KEY,
  CATEGORY_COLOR_PALETTE,
  DEFAULT_CATEGORY_COLOR,
} from "@/src/features/coupons/domain/category-colors";
import {
  CATEGORY_ICON_BY_KEY,
  DEFAULT_CATEGORY_ICON,
} from "@/src/features/coupons/domain/category-icons";
import {
  categorySlugFromName,
  productCategoryColor,
  productCategoryIcon,
} from "@/src/features/products/domain/product-category";

/**
 * A product carries no category SLUG on any route the mobile app can reach:
 * `CatalogProduct` exposes `categoryId` and `categoryName` and nothing else,
 * and the store-private product rows carry the same pair (L9/T8 recorded this
 * as a backend limit). The slug is therefore rebuilt from the name with the
 * SAME rule the catalog seed uses to mint it, so a product falls on the very
 * colour and icon its coupons already use — and NEVER on an id (S11).
 */
describe("the catalog slug rebuilt from a category name", () => {
  // The exact pairs seeded in `packages/backend-core/src/scripts/seed.ts`.
  it.each([
    ["Bebidas gaseosas", "bebidas-gaseosas"],
    ["Lácteos", "lacteos"],
    ["Despensa", "despensa"],
    ["Confitería", "confiteria"],
    ["Higiene del hogar", "higiene-del-hogar"],
  ])("turns %s into the seeded slug %s", (name, slug) => {
    expect(categorySlugFromName(name)).toBe(slug);
  });

  it("is null when there is no name to build one from", () => {
    expect(categorySlugFromName(null)).toBeNull();
    expect(categorySlugFromName(undefined)).toBeNull();
    expect(categorySlugFromName("")).toBeNull();
    expect(categorySlugFromName("   ")).toBeNull();
  });

  it("normalises spacing, case and punctuation the way the seed does", () => {
    expect(categorySlugFromName("  Higiene   del Hogar  ")).toBe(
      "higiene-del-hogar",
    );
    expect(categorySlugFromName("Panadería & Café")).toBe("panaderia-cafe");
  });
});

describe("the tile a product is drawn on", () => {
  it("uses the coupon mapping for a catalog category", () => {
    const key = categorySlugFromName("Lácteos");

    expect(productCategoryIcon(key)).toBe(CATEGORY_ICON_BY_KEY.lacteos);
    expect(productCategoryColor(key)).toEqual(CATEGORY_COLOR_BY_KEY.lacteos);
  });

  it("falls back to the neutral default when the product has no category", () => {
    expect(productCategoryIcon(null)).toBe(DEFAULT_CATEGORY_ICON);
    expect(productCategoryColor(null)).toEqual(DEFAULT_CATEGORY_COLOR);
    expect(productCategoryIcon(categorySlugFromName(null))).toBe(
      DEFAULT_CATEGORY_ICON,
    );
    expect(productCategoryColor(categorySlugFromName(""))).toEqual(
      DEFAULT_CATEGORY_COLOR,
    );
  });

  it("gives an unmapped category a stable pastel and the default icon", () => {
    const own = categorySlugFromName("Empanadas de la casa");

    expect(productCategoryIcon(own)).toBe(DEFAULT_CATEGORY_ICON);
    expect(CATEGORY_COLOR_PALETTE).toContainEqual(productCategoryColor(own));
    expect(productCategoryColor(own)).toEqual(productCategoryColor(own));
  });

  /**
   * S11: the id is never what decides how anything looks, and the signature is
   * what guarantees it — both mappings take the SLUG and nothing else, so two
   * categories with different ids and one name are indistinguishable here.
   */
  it("never derives the tile from the category id", () => {
    const left = categorySlugFromName("Lácteos");
    const right = categorySlugFromName("Lácteos");

    expect(productCategoryColor(left)).toEqual(productCategoryColor(right));
    expect(productCategoryIcon(left)).toBe(productCategoryIcon(right));
  });
});
