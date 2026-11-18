CREATE TABLE "customer_push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"expo_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_push_devices" ADD CONSTRAINT "customer_push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_push_devices_token_uidx" ON "customer_push_devices" USING btree ("expo_token");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_push_devices_family_uidx" ON "customer_push_devices" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "customer_push_devices_user_idx" ON "customer_push_devices" USING btree ("user_id");