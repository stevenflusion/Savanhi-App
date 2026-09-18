CREATE TYPE "public"."registration_status" AS ENUM('profile_required', 'store_required', 'completed');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "registration_status" "registration_status";--> statement-breakpoint
UPDATE "users"
SET "registration_status" = CASE
	WHEN trim("full_name") = '' THEN 'profile_required'::"registration_status"
	WHEN EXISTS (
		SELECT 1 FROM "stores" WHERE "stores"."owner_user_id" = "users"."id"
	) THEN 'completed'::"registration_status"
	ELSE 'store_required'::"registration_status"
END;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "registration_status" SET DEFAULT 'profile_required';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "registration_status" SET NOT NULL;
