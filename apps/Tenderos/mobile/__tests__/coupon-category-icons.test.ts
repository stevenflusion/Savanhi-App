import {
  CATEGORY_ICON_BY_KEY,
  DEFAULT_CATEGORY_ICON,
  categoryIconFor,
} from "@/src/features/coupons/domain/category-icons";

/**
 * The catalog category slugs as they are actually seeded in
 * `packages/backend-core/src/scripts/seed.ts`. The mapping is keyed by the
 * slug and never by the category id, because S11 forbids deriving anything a
 * user sees from an identifier.
 */
const SEEDED_CATEGORY_SLUGS = [
  "bebidas-gaseosas",
  "lacteos",
  "despensa",
  "confiteria",
  "higiene-del-hogar",
];

describe("categoryIconFor", () => {
  it("maps every seeded catalog slug to its own icon", () => {
    const icons = SEEDED_CATEGORY_SLUGS.map((key) =>
      categoryIconFor({ id: "ignored", name: "ignored", key }),
    );

    expect(icons).toEqual([
      "bottle-soda-classic",
      "cheese",
      "food-variant",
      "candy-outline",
      "spray-bottle",
    ]);
    expect(new Set(icons).size).toBe(SEEDED_CATEGORY_SLUGS.length);
    expect(icons).not.toContain(DEFAULT_CATEGORY_ICON);
  });

  it("covers exactly the seeded slugs and nothing invented", () => {
    expect(Object.keys(CATEGORY_ICON_BY_KEY).sort()).toEqual(
      [...SEEDED_CATEGORY_SLUGS].sort(),
    );
  });

  /**
   * A store-authored category has no slug — its name is free text the tendero
   * typed — so `key` is null there and the default icon is the answer (S10).
   */
  it("falls back to the default icon when the category has no slug", () => {
    expect(
      categoryIconFor({ id: "any", name: "Mis empanadas", key: null }),
    ).toBe(DEFAULT_CATEGORY_ICON);
  });

  it("falls back to the default icon when the product has no category at all", () => {
    expect(categoryIconFor(null)).toBe(DEFAULT_CATEGORY_ICON);
    expect(categoryIconFor(undefined)).toBe(DEFAULT_CATEGORY_ICON);
  });

  it("falls back to the default icon for a slug that is not mapped yet", () => {
    expect(
      categoryIconFor({ id: "any", name: "Congelados", key: "congelados" }),
    ).toBe(DEFAULT_CATEGORY_ICON);
    expect(categoryIconFor({ id: "any", name: "", key: "" })).toBe(
      DEFAULT_CATEGORY_ICON,
    );
  });

  /** The icon must never be chosen from an id (S5 display acceptance, S11). */
  it("ignores the category id and name entirely", () => {
    expect(
      categoryIconFor({
        id: "11111111-1111-4111-8111-111111111111",
        name: "Lácteos",
        key: "lacteos",
      }),
    ).toBe("cheese");
    expect(
      categoryIconFor({
        id: "lacteos",
        name: "lacteos",
        key: "higiene-del-hogar",
      }),
    ).toBe("spray-bottle");
  });
});
