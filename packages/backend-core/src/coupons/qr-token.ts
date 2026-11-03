import crypto from "node:crypto";

/**
 * The QR a customer shows at the counter (S3).
 *
 * The token is an opaque bearer secret, so it follows what this codebase
 * already does with bearer secrets: random bytes in, SHA-256 at rest
 * (`auth_sessions.token_hash`, `otp_challenges.code_hash`). Only the hash is
 * stored, so a database dump yields nothing redeemable.
 *
 * 32 bytes is 256 bits of entropy — unguessable, and base64url keeps it to 43
 * printable characters, which a QR encodes comfortably.
 */
const QR_TOKEN_BYTES = 32;

export function createQrToken(): string {
  return crypto.randomBytes(QR_TOKEN_BYTES).toString("base64url");
}

/**
 * The stored form of a token. The redeem path (T6) hashes the scanned token
 * with this same function to find the claim, which is why it is exported
 * rather than kept private to the write path.
 */
export function hashQrToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
