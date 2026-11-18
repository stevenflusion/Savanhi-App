import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildExpiryReminder,
  isExpiryReminderDue,
  expiryReminderGroupForCustomer,
} from "./expiry-reminder-policy.js";

test("reminds only for a still reserved coupon expiring on the next calendar date", () => {
  const tomorrow = "2027-01-01";
  const claim = { status: "claimed", releasedOn: null, validTo: tomorrow };
  assert.equal(isExpiryReminderDue(claim, tomorrow), true);
  assert.equal(isExpiryReminderDue({ ...claim, status: "redeemed" }, tomorrow), false);
  assert.equal(isExpiryReminderDue({ ...claim, releasedOn: "2026-12-31" }, tomorrow), false);
  assert.equal(isExpiryReminderDue({ ...claim, validTo: "2026-12-31" }, tomorrow), false);
  assert.equal(isExpiryReminderDue({ ...claim, validTo: "2027-01-02" }, tomorrow), false);
});

test("uses stable customer-level assignment into two pilot groups", () => {
  const ids = Array.from({ length: 512 }, (_, i) => `test-customer-${i}`);
  const first = ids.map(expiryReminderGroupForCustomer);
  assert.deepEqual(ids.map(expiryReminderGroupForCustomer), first);
  assert.deepEqual(new Set(first), new Set(["reminder", "holdout"]));
  assert.ok(Math.abs(first.filter((value) => value === "reminder").length - 256) < 40);
});

test("the push contains only generic copy and an opaque wallet claim reference", () => {
  assert.deepEqual(buildExpiryReminder("claim-123"), {
    title: "Tu cupón vence mañana",
    body: "Abre Savanhi para ver dónde canjearlo.",
    data: { type: "coupon-expiry-reminder", claimId: "claim-123" },
  });
});
