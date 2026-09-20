CREATE TABLE "catalog_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_observed_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"amount" numeric(12, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"city" text NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_product_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"source" text,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"commercial_name" text NOT NULL,
	"description" text,
	"variant" text,
	"presentation" text,
	"units_per_package" integer,
	"net_content" numeric(12, 3),
	"net_content_unit" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_products_units_positive_chk" CHECK ("catalog_products"."units_per_package" is null or "catalog_products"."units_per_package" > 0),
	CONSTRAINT "catalog_products_content_positive_chk" CHECK ("catalog_products"."net_content" is null or "catalog_products"."net_content" > 0)
);
--> statement-breakpoint
CREATE TABLE "store_catalog_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price" numeric(12, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"stock" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_catalog_products_stock_nonnegative_chk" CHECK ("store_catalog_products"."stock" >= 0),
	CONSTRAINT "store_catalog_products_price_nonnegative_chk" CHECK ("store_catalog_products"."price" is null or "store_catalog_products"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_observed_prices" ADD CONSTRAINT "catalog_observed_prices_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_identifiers" ADD CONSTRAINT "catalog_product_identifiers_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_category_id_catalog_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."catalog_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_brand_id_catalog_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."catalog_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_catalog_products" ADD CONSTRAINT "store_catalog_products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_catalog_products" ADD CONSTRAINT "store_catalog_products_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_brands_name_uidx" ON "catalog_brands" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_categories_slug_uidx" ON "catalog_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "catalog_observed_prices_product_date_idx" ON "catalog_observed_prices" USING btree ("product_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_observed_prices_snapshot_uidx" ON "catalog_observed_prices" USING btree ("product_id","source","observed_at");--> statement-breakpoint
CREATE INDEX "catalog_product_identifiers_product_idx" ON "catalog_product_identifiers" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_product_identifiers_value_uidx" ON "catalog_product_identifiers" USING btree ("kind","value");--> statement-breakpoint
CREATE INDEX "catalog_products_brand_name_idx" ON "catalog_products" USING btree ("brand_id","commercial_name");--> statement-breakpoint
CREATE UNIQUE INDEX "store_catalog_products_store_product_uidx" ON "store_catalog_products" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "store_catalog_products_store_idx" ON "store_catalog_products" USING btree ("store_id");