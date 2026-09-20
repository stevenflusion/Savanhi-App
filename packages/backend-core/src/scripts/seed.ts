import { eq } from "drizzle-orm";
import { createDatabaseConnection } from "../database/connection.js";
import { createEnv } from "../env.js";
import {
  catalogBrands,
  catalogCategories,
  catalogObservedPrices,
  catalogProductIdentifiers,
  catalogProducts,
  roles,
} from "../database/schema.js";

const env = createEnv({ serviceName: "database-seed", defaultPort: 1 });
const db = createDatabaseConnection(env);
const snapshotDate = new Date("2026-09-20T00:00:00.000Z");
const source = "Supermaxi Quito";
const referenceNote =
  "Initial Supermaxi Quito reference snapshot; price is not definitive.";

await db
  .insert(roles)
  .values(
    ["admin", "marca", "client", "tendero", "delivery"].map((name) => ({
      name,
    })),
  )
  .onConflictDoNothing();

const categoryDefinitions = [
  ["Bebidas gaseosas", "bebidas-gaseosas"],
  ["Lácteos", "lacteos"],
  ["Despensa", "despensa"],
  ["Confitería", "confiteria"],
  ["Higiene del hogar", "higiene-del-hogar"],
] as const;

const categoryBySlug = new Map<string, string>();
for (const [name, slug] of categoryDefinitions) {
  await db
    .insert(catalogCategories)
    .values({ name, slug })
    .onConflictDoNothing({ target: catalogCategories.slug });
  const category = await db.query.catalogCategories.findFirst({
    where: (table, { eq: equals }) => equals(table.slug, slug),
  });
  if (!category) throw new Error(`Catalog category seed failed: ${slug}`);
  categoryBySlug.set(slug, category.id);
}

const brandNames = ["Coca-Cola", "Toni", "La Lechera", "Nestlé", "Familia"];
const brandByName = new Map<string, string>();
for (const name of brandNames) {
  await db
    .insert(catalogBrands)
    .values({ name })
    .onConflictDoNothing({ target: catalogBrands.name });
  const brand = await db.query.catalogBrands.findFirst({
    where: (table, { eq: equals }) => equals(table.name, name),
  });
  if (!brand) throw new Error(`Catalog brand seed failed: ${name}`);
  brandByName.set(name, brand.id);
}

type ProductSeed = {
  brand: string;
  category: string;
  commercialName: string;
  description: string;
  variant: string;
  presentation: string;
  unitsPerPackage: number | null;
  netContent: string;
  netContentUnit: string;
  price: string | null;
};

const products: ProductSeed[] = [
  {
    brand: "Coca-Cola",
    category: "bebidas-gaseosas",
    commercialName: "Coca-Cola Original",
    description: "Carbonated soft drink with classic Coca-Cola flavor.",
    variant: "Original",
    presentation: "500 ml bottle",
    unitsPerPackage: null,
    netContent: "500",
    netContentUnit: "ml",
    price: null,
  },
  {
    brand: "Coca-Cola",
    category: "bebidas-gaseosas",
    commercialName: "Coca-Cola Original",
    description: "Carbonated soft drink with classic Coca-Cola flavor.",
    variant: "Original",
    presentation: "1.35 L bottle",
    unitsPerPackage: null,
    netContent: "1.35",
    netContentUnit: "L",
    price: null,
  },
  {
    brand: "Coca-Cola",
    category: "bebidas-gaseosas",
    commercialName: "Coca-Cola Original",
    description: "Carbonated soft drink with classic Coca-Cola flavor.",
    variant: "Original",
    presentation: "2.5 L bottle",
    unitsPerPackage: null,
    netContent: "2.5",
    netContentUnit: "L",
    price: null,
  },
  {
    brand: "Coca-Cola",
    category: "bebidas-gaseosas",
    commercialName: "Coca-Cola Sin Azúcar",
    description: "Zero-sugar carbonated soft drink.",
    variant: "Sin azúcar",
    presentation: "500 ml bottle",
    unitsPerPackage: null,
    netContent: "500",
    netContentUnit: "ml",
    price: null,
  },
  {
    brand: "Coca-Cola",
    category: "bebidas-gaseosas",
    commercialName: "Coca-Cola Sin Azúcar",
    description: "Zero-sugar carbonated soft drink.",
    variant: "Sin azúcar",
    presentation: "1.5 L bottle",
    unitsPerPackage: null,
    netContent: "1.5",
    netContentUnit: "L",
    price: null,
  },
  {
    brand: "Toni",
    category: "lacteos",
    commercialName: "Yogurt Toni Semidescremado Deslactosado Durazno",
    description: "Cultured dairy yogurt with peach flavor.",
    variant: "Semidescremado deslactosado durazno",
    presentation: "190 g cup",
    unitsPerPackage: null,
    netContent: "190",
    netContentUnit: "g",
    price: "0.72",
  },
  {
    brand: "Toni",
    category: "lacteos",
    commercialName: "Yogurt Toni Clásico",
    description: "Classic cultured dairy yogurt.",
    variant: "Clásico",
    presentation: "950 g bottle",
    unitsPerPackage: null,
    netContent: "950",
    netContentUnit: "g",
    price: "3.33",
  },
  {
    brand: "Toni",
    category: "lacteos",
    commercialName: "Yogurt Toni Durazno",
    description: "Cultured dairy yogurt with peach flavor.",
    variant: "Durazno",
    presentation: "180 g cup",
    unitsPerPackage: null,
    netContent: "180",
    netContentUnit: "g",
    price: null,
  },
  {
    brand: "Toni",
    category: "lacteos",
    commercialName: "Leche Toni Entera",
    description: "Whole milk for everyday consumption.",
    variant: "Entera",
    presentation: "1 L carton",
    unitsPerPackage: null,
    netContent: "1",
    netContentUnit: "L",
    price: null,
  },
  {
    brand: "Toni",
    category: "lacteos",
    commercialName: "Leche Toni Deslactosada",
    description: "Lactose-free milk for everyday consumption.",
    variant: "Deslactosada",
    presentation: "1 L carton",
    unitsPerPackage: null,
    netContent: "1",
    netContentUnit: "L",
    price: null,
  },
  {
    brand: "La Lechera",
    category: "lacteos",
    commercialName: "Leche Condensada La Lechera",
    description: "Sweetened condensed milk.",
    variant: "Condensada",
    presentation: "397 g can",
    unitsPerPackage: null,
    netContent: "397",
    netContentUnit: "g",
    price: null,
  },
  {
    brand: "La Lechera",
    category: "lacteos",
    commercialName: "Leche Evaporada La Lechera",
    description: "Evaporated milk.",
    variant: "Evaporada",
    presentation: "410 g can",
    unitsPerPackage: null,
    netContent: "410",
    netContentUnit: "g",
    price: null,
  },
  {
    brand: "La Lechera",
    category: "lacteos",
    commercialName: "Leche Condensada La Lechera",
    description: "Sweetened condensed milk in a small format.",
    variant: "Condensada",
    presentation: "100 g pouch",
    unitsPerPackage: null,
    netContent: "100",
    netContentUnit: "g",
    price: null,
  },
  {
    brand: "La Lechera",
    category: "lacteos",
    commercialName: "Dulce de Leche La Lechera",
    description: "Milk caramel spread.",
    variant: "Dulce de leche",
    presentation: "250 g jar",
    unitsPerPackage: null,
    netContent: "250",
    netContentUnit: "g",
    price: null,
  },
  {
    brand: "La Lechera",
    category: "lacteos",
    commercialName: "Crema de Leche La Lechera",
    description: "Dairy cream for cooking and desserts.",
    variant: "Crema de leche",
    presentation: "200 ml carton",
    unitsPerPackage: null,
    netContent: "200",
    netContentUnit: "ml",
    price: null,
  },
  {
    brand: "Nestlé",
    category: "confiteria",
    commercialName: "KitKat Chocolate Blanco",
    description: "White-chocolate-covered wafer bar.",
    variant: "Chocolate blanco",
    presentation: "41.5 g bar",
    unitsPerPackage: null,
    netContent: "41.5",
    netContentUnit: "g",
    price: "0.92",
  },
  {
    brand: "Nestlé",
    category: "confiteria",
    commercialName: "KitKat Cereal de Trigo con Chocolate",
    description: "Wheat cereal covered with chocolate.",
    variant: "Cereal de trigo con chocolate",
    presentation: "210 g bar",
    unitsPerPackage: null,
    netContent: "210",
    netContentUnit: "g",
    price: "3.26",
  },
  {
    brand: "Nestlé",
    category: "confiteria",
    commercialName: "KitKat Paleta Toffee",
    description: "Toffee-flavored chocolate confectionery lollipop.",
    variant: "Toffee",
    presentation: "85 ml lollipop",
    unitsPerPackage: null,
    netContent: "85",
    netContentUnit: "ml",
    price: "2.75",
  },
  {
    brand: "Nestlé",
    category: "despensa",
    commercialName: "Nescafé Dolce Gusto Sabor KitKat",
    description: "Coffee capsules with KitKat flavor.",
    variant: "Sabor KitKat",
    presentation: "170 g package",
    unitsPerPackage: null,
    netContent: "170",
    netContentUnit: "g",
    price: "6.46",
  },
  {
    brand: "Nestlé",
    category: "confiteria",
    commercialName: "Chocolate Nestlé Maní",
    description: "Milk chocolate bar with peanuts.",
    variant: "Maní",
    presentation: "100 g bar",
    unitsPerPackage: null,
    netContent: "100",
    netContentUnit: "g",
    price: null,
  },
  {
    brand: "Familia",
    category: "higiene-del-hogar",
    commercialName: "Familia Toallas de Cocina",
    description: "Absorbent paper kitchen towels.",
    variant: "Toallas de cocina",
    presentation: "3-roll pack",
    unitsPerPackage: 3,
    netContent: "3",
    netContentUnit: "rolls",
    price: null,
  },
  {
    brand: "Familia",
    category: "higiene-del-hogar",
    commercialName: "Familia Servilletas",
    description: "Paper napkins for household use.",
    variant: "Servilletas",
    presentation: "100-count pack",
    unitsPerPackage: 100,
    netContent: "100",
    netContentUnit: "units",
    price: null,
  },
  {
    brand: "Familia",
    category: "higiene-del-hogar",
    commercialName: "Familia Papel Higiénico",
    description: "Household toilet paper rolls.",
    variant: "Papel higiénico",
    presentation: "12-roll pack",
    unitsPerPackage: 12,
    netContent: "12",
    netContentUnit: "rolls",
    price: null,
  },
  {
    brand: "Familia",
    category: "higiene-del-hogar",
    commercialName: "Familia Pañuelos Faciales",
    description: "Soft facial tissues for household use.",
    variant: "Pañuelos faciales",
    presentation: "90-count box",
    unitsPerPackage: 90,
    netContent: "90",
    netContentUnit: "units",
    price: null,
  },
  {
    brand: "Familia",
    category: "higiene-del-hogar",
    commercialName: "Familia Toallas Húmedas",
    description: "Moist household cleaning wipes.",
    variant: "Toallas húmedas",
    presentation: "50-count pack",
    unitsPerPackage: 50,
    netContent: "50",
    netContentUnit: "units",
    price: null,
  },
];

const seededProducts = [];
for (const productSeed of products) {
  const brandId = brandByName.get(productSeed.brand);
  const categoryId = categoryBySlug.get(productSeed.category);
  if (!brandId || !categoryId)
    throw new Error("Catalog product seed references missing data");

  const values = {
    categoryId,
    brandId,
    commercialName: productSeed.commercialName,
    description: productSeed.description,
    variant: productSeed.variant,
    presentation: productSeed.presentation,
    unitsPerPackage: productSeed.unitsPerPackage,
    netContent: productSeed.netContent,
    netContentUnit: productSeed.netContentUnit,
  };
  const existingProducts = await db.query.catalogProducts.findMany({
    where: (table, { and: all, eq: equals }) =>
      all(
        equals(table.brandId, brandId),
        equals(table.commercialName, productSeed.commercialName),
      ),
  });
  const existing =
    existingProducts.find(
      (candidate) => candidate.presentation === productSeed.presentation,
    ) ??
    existingProducts.find(
      (candidate) =>
        candidate.presentation === null ||
        productSeed.presentation.startsWith(candidate.presentation),
    );
  const product = existing
    ? (
        await db
          .update(catalogProducts)
          .set(values)
          .where(eq(catalogProducts.id, existing.id))
          .returning()
      )[0]
    : (await db.insert(catalogProducts).values(values).returning())[0];
  if (!product)
    throw new Error(
      `Catalog product seed failed: ${productSeed.commercialName}`,
    );
  seededProducts.push({ product, price: productSeed.price });
}

for (const { product, price } of seededProducts) {
  await db
    .insert(catalogObservedPrices)
    .values({
      productId: product.id,
      amount: price,
      currency: "USD",
      city: "Quito",
      source,
      observedAt: snapshotDate,
      verified: false,
      notes: referenceNote,
    })
    .onConflictDoUpdate({
      target: [
        catalogObservedPrices.productId,
        catalogObservedPrices.source,
        catalogObservedPrices.observedAt,
      ],
      set: {
        amount: price,
        currency: "USD",
        city: "Quito",
        verified: false,
        notes: referenceNote,
      },
    });
  await db
    .insert(catalogProductIdentifiers)
    .values({
      productId: product.id,
      kind: "ean13",
      value: null,
      source,
      verified: false,
      notes: "EAN-13 not verified in the initial reference snapshot.",
    })
    .onConflictDoNothing({
      target: [
        catalogProductIdentifiers.productId,
        catalogProductIdentifiers.kind,
      ],
    });
}

await db.pool.end();
