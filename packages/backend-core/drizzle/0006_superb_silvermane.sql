CREATE TABLE "store_product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_catalog_products" DROP CONSTRAINT "store_catalog_products_price_nonnegative_chk";--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "stock" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "stock" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "store_catalog_products" ALTER COLUMN "stock" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "store_catalog_products" ALTER COLUMN "stock" SET DEFAULT '1';--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sale_unit" text DEFAULT 'unidad' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "integer_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "store_category_id" uuid;--> statement-breakpoint
ALTER TABLE "store_catalog_products" ADD COLUMN "sale_unit" text DEFAULT 'unidad' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_catalog_products" ADD COLUMN "integer_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_product_categories" ADD CONSTRAINT "store_product_categories_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_product_categories_store_name_uidx" ON "store_product_categories" USING btree ("store_id","name");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_catalog_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."catalog_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_category_id_store_product_categories_id_fk" FOREIGN KEY ("store_category_id") REFERENCES "public"."store_product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "products" SET "active" = false WHERE "price" IS NULL OR "price" <= 0;--> statement-breakpoint
UPDATE "store_catalog_products" SET "active" = false WHERE "price" IS NULL OR "price" <= 0;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_active_price_positive_chk" CHECK (("products"."price" is not null and "products"."price" > 0) or not "products"."active");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_stock_nonnegative_chk" CHECK ("products"."stock" >= 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_sale_unit_chk" CHECK ("products"."sale_unit" in ('unidad', 'kg', 'g', 'L', 'ml'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_integer_stock_chk" CHECK (("products"."sale_unit" <> 'unidad' and not "products"."integer_only") or "products"."stock" = trunc("products"."stock"));--> statement-breakpoint
ALTER TABLE "store_catalog_products" ADD CONSTRAINT "store_catalog_products_sale_unit_chk" CHECK ("store_catalog_products"."sale_unit" in ('unidad', 'kg', 'g', 'L', 'ml'));--> statement-breakpoint
ALTER TABLE "store_catalog_products" ADD CONSTRAINT "store_catalog_products_integer_stock_chk" CHECK (("store_catalog_products"."sale_unit" <> 'unidad' and not "store_catalog_products"."integer_only") or "store_catalog_products"."stock" = trunc("store_catalog_products"."stock"));--> statement-breakpoint
ALTER TABLE "store_catalog_products" ADD CONSTRAINT "store_catalog_products_price_nonnegative_chk" CHECK (("store_catalog_products"."price" is not null and "store_catalog_products"."price" > 0) or not "store_catalog_products"."active");
