import type {
  AuthErrorResponse,
  AuthSession,
  AuthUser,
} from "@repo/api-contracts";
import Constants from "expo-constants";

import type {
  AuthRemoteRepository,
  RefreshSessionResult,
} from "../application/ports/auth-remote-repository";
import type { OtpFailureState } from "../application/otp-flow";
import { resolveTenderosApiBaseUrl } from "./api-base-url";

const API_BASE_URL = resolveTenderosApiBaseUrl({
  override: process.env.EXPO_PUBLIC_TENDEROS_API_URL,
  expoHostUri: Constants.expoConfig?.hostUri,
  isDevelopment: __DEV__,
});

const REFRESH_RESULT_REUSE_WINDOW_MS = 60_000;

type RefreshRequestEntry = {
  promise: Promise<RefreshSessionResult>;
  expiresAt: number | null;
};

const refreshRequestsByToken = new Map<string, RefreshRequestEntry>();

function pruneRefreshRequests(now: number) {
  for (const [token, entry] of refreshRequestsByToken) {
    if (entry.expiresAt !== null && entry.expiresAt <= now) {
      refreshRequestsByToken.delete(token);
    }
  }
}

async function parseJson(response: Response) {
  return response.json().catch(() => {
    throw new Error("Respuesta invalida del backend.");
  });
}

export async function authorizedFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {},
) {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

async function authFailure(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return {
    success: false as const,
    error: data.error ?? fallback,
    status: response.status,
    unauthorized: response.status === 401,
  };
}

function otpFailureState(
  response: Response,
  data: AuthErrorResponse,
  unauthorizedFallback: OtpFailureState,
): OtpFailureState {
  if (
    data.code === "incorrect_code" ||
    data.code === "expired_code" ||
    data.code === "rate_limited" ||
    data.code === "provider_error"
  ) {
    return data.code;
  }
  if (response.status === 429) return "rate_limited";
  if (response.status === 401) return unauthorizedFallback;
  return "provider_error";
}

export function createAuthFetchRepository(): AuthRemoteRepository {
  return {
    async refreshSession(refreshToken) {
      pruneRefreshRequests(Date.now());
      const existing = refreshRequestsByToken.get(refreshToken);
      if (existing) return existing.promise;

      const refreshRequest = (async (): Promise<RefreshSessionResult> => {
        try {
          const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken }),
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            return {
              success: false,
              error: data.error ?? "No se pudo renovar la sesión.",
              status: response.status,
              terminal: response.status === 400 || response.status === 401,
            };
          }

          const data = await parseJson(response);
          return {
            success: true,
            session: data.session as AuthSession,
          };
        } catch {
          return {
            success: false,
            error: "No se pudo conectar con el servidor.",
            terminal: false,
          };
        }
      })();
      const entry: RefreshRequestEntry = {
        promise: refreshRequest,
        expiresAt: null,
      };
      refreshRequestsByToken.set(refreshToken, entry);
      void refreshRequest.then((result) => {
        if (refreshRequestsByToken.get(refreshToken) !== entry) return;
        if (!result.success) {
          refreshRequestsByToken.delete(refreshToken);
          return;
        }
        entry.expiresAt = Date.now() + REFRESH_RESULT_REUSE_WINDOW_MS;
      });

      return refreshRequest;
    },

    async getCurrentUser(accessToken) {
      try {
        const response = await authorizedFetch(accessToken, "/auth/me");
        if (!response.ok) {
          return authFailure(response, "No se pudo recuperar la sesión.");
        }
        const data = await parseJson(response);
        return { success: true, data: data.user };
      } catch {
        return {
          success: false,
          error: "No se pudo conectar con el servidor.",
          unauthorized: false,
        };
      }
    },

    async updateProfile(payload, accessToken) {
      try {
        const response = await authorizedFetch(accessToken, "/auth/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          return authFailure(response, "No se pudo guardar el perfil.");
        }
        const data = await parseJson(response);
        return { success: true, data: data.user };
      } catch {
        return {
          success: false,
          error: "No se pudo conectar con el servidor.",
          unauthorized: false,
        };
      }
    },

    async requestOtp(email) {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/otp/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });

        if (!response.ok) {
          const data = (await response
            .json()
            .catch(() => ({}))) as Partial<AuthErrorResponse>;
          const headerRetryAfter = Number(response.headers.get("Retry-After"));
          return {
            success: false,
            state: otpFailureState(
              response,
              data as AuthErrorResponse,
              "provider_error",
            ),
            retryAfterSeconds:
              (Number.isFinite(headerRetryAfter) && headerRetryAfter > 0
                ? headerRetryAfter
                : undefined) ?? data.details?.retryAfterSeconds,
            error: data.error ?? "No pudimos enviar el código. Probá de nuevo.",
          };
        }

        const data = await parseJson(response);
        return {
          success: true,
          state: "sent",
          challengeId: String(data.challengeId),
          cooldownSeconds: Number(data.cooldownSeconds) || 0,
        };
      } catch {
        return {
          success: false,
          state: "offline",
          error:
            "No pudimos comunicarnos con la app. Revisá que el servidor esté encendido y que el celular esté en la misma red Wi-Fi.",
        };
      }
    },

    async verifyOtp(email, challengeId, code) {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/otp/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, challengeId, token: code }),
        });

        const data = (await parseJson(response)) as AuthErrorResponse & {
          user?: AuthUser;
          session?: AuthSession;
        };
        if (!response.ok) {
          return {
            success: false,
            state: otpFailureState(response, data, "incorrect_code"),
            retryAfterSeconds: data.details?.retryAfterSeconds,
            error: data.error ?? "Código inválido",
          };
        }

        return {
          success: true,
          user: data.user!,
          session: data.session!,
        };
      } catch {
        return {
          success: false,
          state: "offline",
          error: "No se pudo conectar con el servidor.",
        };
      }
    },

    async completeRegistration({ user, onboardingDraft, accessToken }) {
      try {
        const response = await authorizedFetch(
          accessToken,
          "/auth/registration/complete",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fullName: user.fullName,
              store: {
                name: onboardingDraft?.storeName,
                address: onboardingDraft?.address,
                latitude: onboardingDraft?.latitude,
                longitude: onboardingDraft?.longitude,
                paymentMethod: onboardingDraft?.paymentMethod,
              },
            }),
          },
        );
        if (!response.ok) {
          return authFailure(response, "No se pudo completar el registro.");
        }
        const data = await parseJson(response);

        return {
          success: true,
          data: { user: data.user, storeId: data.storeId },
        };
      } catch {
        return {
          success: false,
          error: "No se pudo conectar con el servidor.",
          unauthorized: false,
        };
      }
    },

    async logout({ accessToken }) {
      await authorizedFetch(accessToken, "/auth/logout", { method: "POST" });
    },
  };
}
