/**
 * The name the tendero sees when a QR is scanned (S3, S11).
 *
 * A redemption puts a customer's identity in front of a stranger, so only the
 * first name travels: it is enough to say "this is your coupon" out loud at the
 * counter, and it leaks neither the surname nor the email the account is keyed
 * by. The email in particular is never a fallback — it is the account
 * identifier, and S11 keeps identifiers off every screen.
 *
 * `null` rather than invented copy when there is no name at all: an
 * OTP-registered user carries an empty `full_name` until the profile step, so
 * the absence is a real production state, and the wording for it belongs to the
 * app that renders it (the Spanish UI copy convention of
 * `apps/Tenderos/mobile`), not to this response.
 */
export function customerDisplayName(fullName: string): string | null {
  const [firstName] = fullName.trim().split(/\s+/);
  return firstName ? firstName : null;
}
