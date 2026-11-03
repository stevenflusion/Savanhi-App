CREATE TABLE "store_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_photos_content_type_chk" CHECK ("store_photos"."content_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "store_photos_byte_size_positive_chk" CHECK ("store_photos"."byte_size" > 0),
	CONSTRAINT "store_photos_position_nonnegative_chk" CHECK ("store_photos"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store_photos" ADD CONSTRAINT "store_photos_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_photos_store_idx" ON "store_photos" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_photos_object_key_uidx" ON "store_photos" USING btree ("object_key");