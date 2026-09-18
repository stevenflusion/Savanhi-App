import type { OtpAuthState } from "@repo/api-contracts";

export type OtpFailureState = Exclude<
  OtpAuthState,
  "sending" | "sent"
>;

export type OtpDeadlineResult = {
  success: boolean;
  cooldownSeconds?: number;
  retryAfterSeconds?: number;
};

export function normalizeOtpCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function getOtpDeadline(now: number, result: OtpDeadlineResult) {
  const seconds = result.success
    ? result.cooldownSeconds
    : result.retryAfterSeconds;
  return now + Math.max(0, seconds ?? 0) * 1000;
}

export function createSynchronousLock() {
  let locked = false;

  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
  };
}

export function getOtpFailureMessage(
  state: OtpFailureState,
  fallback?: string,
) {
  switch (state) {
    case "incorrect_code":
      return "El código es incorrecto. Inténtalo de nuevo.";
    case "expired_code":
      return "El código venció. Solicita uno nuevo.";
    case "rate_limited":
      return "Espera antes de solicitar otro código.";
    case "offline":
      return "Sin conexión. Revisa tu internet e inténtalo de nuevo.";
    case "provider_error":
      return fallback ?? "No pudimos procesar el código. Inténtalo de nuevo.";
  }

  return fallback ?? "No pudimos procesar el código. Inténtalo de nuevo.";
}
