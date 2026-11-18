import type { buildExpiryReminder } from "./expiry-reminder-policy.js";

/** Fixed on purpose: the destination is code, never configuration or input. */
export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * What the provider told us, not what the person received.
 *
 * `accepted` means Expo returned an OK ticket for the message. It says nothing
 * about delivery (receipts are never read), so reports count it as acceptance.
 * `unknown` is any outcome we could not observe: a timeout, a network error, a
 * 5xx or an answer we cannot parse. The request may have been processed, so the
 * caller must never repeat it.
 */
export type PushOutcome = "accepted" | "device_not_registered" | "rejected" | "unknown";

export interface ExpiryPushInput {
  to: string;
  message: ReturnType<typeof buildExpiryReminder>;
  /** Unix seconds after which Expo must stop trying: the end of the coupon day. */
  expiresAtEpoch: number;
}

export function createExpoExpiryPush({
  fetch: fetchImpl = fetch,
  timeoutMs = 5000,
}: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
  return {
    /** One attempt, one request. Never throws; raw provider details never leave here. */
    async send({ to, message, expiresAtEpoch }: ExpiryPushInput): Promise<PushOutcome> {
      try {
        const response = await fetchImpl(EXPO_PUSH_URL, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ to, ...message, expiration: expiresAtEpoch, priority: "high" }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        // A 4xx is a definite refusal; a 5xx may still have been processed.
        if (response.status >= 400 && response.status < 500) return "rejected";
        if (!response.ok) return "unknown";
        const ticket = ((await response.json()) as { data?: unknown }).data as
          | { status?: string; details?: { error?: string } }
          | undefined;
        if (ticket?.status === "ok") return "accepted";
        if (ticket?.status !== "error") return "unknown";
        return ticket.details?.error === "DeviceNotRegistered" ? "device_not_registered" : "rejected";
      } catch {
        return "unknown";
      }
    },
  };
}
