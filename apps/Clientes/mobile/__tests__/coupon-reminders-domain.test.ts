import {
  COUPON_REMINDER_TYPE,
  parseReminderTap,
} from "@/src/features/coupon-reminders/domain/reminder";

const CLAIM = "d1111111-1111-4111-8111-111111111111";
const tap = (over: Record<string, unknown> = {}) => ({
  id: "n-1",
  isDefaultAction: true,
  data: { type: COUPON_REMINDER_TYPE, claimId: CLAIM },
  ...over,
});

describe("parseReminderTap", () => {
  it("accepts only the coupon reminder type with a well-formed claim id", () => {
    expect(COUPON_REMINDER_TYPE).toBe("coupon-expiry-reminder");
    expect(parseReminderTap(tap())).toBe(CLAIM);
  });

  it.each([
    ["another notification type", { type: "promo", claimId: CLAIM }],
    ["a missing type", { claimId: CLAIM }],
    ["a missing claim id", { type: COUPON_REMINDER_TYPE }],
    ["a non-string claim id", { type: COUPON_REMINDER_TYPE, claimId: 7 }],
    ["a claim id that is not an id", { type: COUPON_REMINDER_TYPE, claimId: "../wallet?x=1" }],
    ["an empty claim id", { type: COUPON_REMINDER_TYPE, claimId: "" }],
    ["no data", null],
    ["data that is not an object", "coupon-expiry-reminder"],
  ])("ignores %s", (_name, data) => {
    expect(parseReminderTap(tap({ data }))).toBeNull();
  });

  it("ignores a response that is not the default tap action", () => {
    expect(parseReminderTap(tap({ isDefaultAction: false }))).toBeNull();
  });
});
