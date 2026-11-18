CREATE TABLE "coupon_expiry_reminders" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"arm" text NOT NULL,
	"state" text DEFAULT 'assigned' NOT NULL,
	"assigned_on" date NOT NULL,
	"device_id" uuid,
	"attempted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_expiry_reminders_arm_chk" CHECK ("coupon_expiry_reminders"."arm" in ('reminder', 'holdout')),
	CONSTRAINT "coupon_expiry_reminders_state_chk" CHECK ("coupon_expiry_reminders"."state" in ('assigned', 'sending', 'accepted', 'rejected', 'unknown', 'skipped')),
	CONSTRAINT "coupon_expiry_reminders_holdout_chk" CHECK ("coupon_expiry_reminders"."arm" = 'reminder' or "coupon_expiry_reminders"."state" = 'assigned')
);
--> statement-breakpoint
ALTER TABLE "coupon_expiry_reminders" ADD CONSTRAINT "coupon_expiry_reminders_claim_id_coupon_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."coupon_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupon_expiry_reminders_state_idx" ON "coupon_expiry_reminders" USING btree ("state","created_at");