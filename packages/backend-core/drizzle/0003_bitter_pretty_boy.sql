CREATE TABLE "auth_rate_limits" (
	"action" text NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_request_leases" (
	"email_normalized" text PRIMARY KEY NOT NULL,
	"lease_token" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "cooldown_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limits_bucket_uidx" ON "auth_rate_limits" USING btree ("action","scope","key");--> statement-breakpoint
CREATE INDEX "auth_rate_limits_reset_idx" ON "auth_rate_limits" USING btree ("reset_at");--> statement-breakpoint
CREATE INDEX "otp_request_leases_expiry_idx" ON "otp_request_leases" USING btree ("expires_at");--> statement-breakpoint
WITH "ranked_active_challenges" AS (
	SELECT "id", row_number() OVER (
		PARTITION BY "email_normalized"
		ORDER BY "created_at" DESC, "id" DESC
	) AS "active_rank"
	FROM "otp_challenges"
	WHERE "consumed_at" IS NULL AND "locked_at" IS NULL
)
UPDATE "otp_challenges"
SET "locked_at" = clock_timestamp()
FROM "ranked_active_challenges"
WHERE "otp_challenges"."id" = "ranked_active_challenges"."id"
	AND "ranked_active_challenges"."active_rank" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "otp_challenges_active_email_uidx" ON "otp_challenges" USING btree ("email_normalized") WHERE "otp_challenges"."consumed_at" is null and "otp_challenges"."locked_at" is null;
