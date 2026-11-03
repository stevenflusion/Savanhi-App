CREATE TABLE "coupon_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"qr_token_hash" text NOT NULL,
	"claimed_on" date DEFAULT current_date NOT NULL,
	"redeemed_on" date,
	"redeemed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_claims_status_chk" CHECK ("coupon_claims"."status" in ('claimed', 'redeemed')),
	CONSTRAINT "coupon_claims_redemption_chk" CHECK (("coupon_claims"."status" = 'redeemed' and "coupon_claims"."redeemed_on" is not null and "coupon_claims"."redeemed_by_user_id" is not null)
        or ("coupon_claims"."status" <> 'redeemed' and "coupon_claims"."redeemed_on" is null and "coupon_claims"."redeemed_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "coupon_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"store_catalog_product_id" uuid,
	"store_product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_products_single_source_chk" CHECK (num_nonnulls("coupon_products"."store_catalog_product_id", "coupon_products"."store_product_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"free_text" text,
	"percentage_value" integer,
	"fixed_amount_value" numeric(12, 2),
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"total_stock" integer NOT NULL,
	"claimed_count" integer DEFAULT 0 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"image_object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_type_chk" CHECK ("coupons"."type" in ('free_text', 'combo', 'percentage', 'fixed_amount')),
	CONSTRAINT "coupons_type_value_chk" CHECK (("coupons"."type" <> 'free_text' or ("coupons"."free_text" is not null and "coupons"."percentage_value" is null and "coupons"."fixed_amount_value" is null))
        and ("coupons"."type" <> 'percentage' or ("coupons"."percentage_value" is not null and "coupons"."free_text" is null and "coupons"."fixed_amount_value" is null))
        and ("coupons"."type" <> 'fixed_amount' or ("coupons"."fixed_amount_value" is not null and "coupons"."free_text" is null and "coupons"."percentage_value" is null))
        and ("coupons"."type" <> 'combo' or ("coupons"."free_text" is null and "coupons"."percentage_value" is null and "coupons"."fixed_amount_value" is null))),
	CONSTRAINT "coupons_percentage_range_chk" CHECK ("coupons"."percentage_value" is null or ("coupons"."percentage_value" >= 1 and "coupons"."percentage_value" <= 100)),
	CONSTRAINT "coupons_fixed_amount_positive_chk" CHECK ("coupons"."fixed_amount_value" is null or "coupons"."fixed_amount_value" > 0),
	CONSTRAINT "coupons_validity_order_chk" CHECK ("coupons"."valid_from" <= "coupons"."valid_to"),
	CONSTRAINT "coupons_total_stock_nonnegative_chk" CHECK ("coupons"."total_stock" >= 0),
	CONSTRAINT "coupons_claimed_within_stock_chk" CHECK ("coupons"."claimed_count" >= 0 and "coupons"."claimed_count" <= greatest("coupons"."total_stock", 0))
);
--> statement-breakpoint
CREATE TABLE "store_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coupon_claims" ADD CONSTRAINT "coupon_claims_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_claims" ADD CONSTRAINT "coupon_claims_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_claims" ADD CONSTRAINT "coupon_claims_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_store_catalog_product_id_store_catalog_products_id_fk" FOREIGN KEY ("store_catalog_product_id") REFERENCES "public"."store_catalog_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_store_product_id_products_id_fk" FOREIGN KEY ("store_product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_follows" ADD CONSTRAINT "store_follows_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_follows" ADD CONSTRAINT "store_follows_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_claims_coupon_customer_uidx" ON "coupon_claims" USING btree ("coupon_id","customer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_claims_qr_token_hash_uidx" ON "coupon_claims" USING btree ("qr_token_hash");--> statement-breakpoint
CREATE INDEX "coupon_claims_customer_idx" ON "coupon_claims" USING btree ("customer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_products_coupon_catalog_uidx" ON "coupon_products" USING btree ("coupon_id","store_catalog_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_products_coupon_private_uidx" ON "coupon_products" USING btree ("coupon_id","store_product_id");--> statement-breakpoint
CREATE INDEX "coupons_store_idx" ON "coupons" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "coupons_validity_idx" ON "coupons" USING btree ("valid_from","valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_image_object_key_uidx" ON "coupons" USING btree ("image_object_key") WHERE "coupons"."image_object_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "store_follows_customer_store_uidx" ON "store_follows" USING btree ("customer_user_id","store_id");--> statement-breakpoint
CREATE INDEX "store_follows_store_idx" ON "store_follows" USING btree ("store_id");