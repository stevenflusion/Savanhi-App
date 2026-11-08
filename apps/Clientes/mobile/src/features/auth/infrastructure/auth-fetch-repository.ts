import type {
  AuthErrorResponse,
  AuthSession,
  AuthUser,
  CustomerEligibility,
  CustomerProfile,
  OtpVerifyRequest,
} from "@repo/api-contracts";
import Constants from "expo-constants";

import type {
  AuthRemoteRepository,
  AuthRemoteResult,
  RefreshSessionResult,
} from "../application/ports";
import type { OtpFailureState } from "../application/otp-flow";
import { resolveClientesApiBaseUrl } from "./api-base-url";

const OFFLINE_MESSAGE =
  "No pudimos conectarnos con el servidor. Revisa tu conexión e intenta de nuevo.";
const OTP_REQUEST_MESSAGE = "No pudimos enviar el código. Intenta de nuevo.";
const OTP_VERIFY_MESSAGE = "No pudimos verificar el código. Intenta de nuevo.";
const REFRESH_MESSAGE = "No pudimos renovar tu sesión.";
const REQUEST_MESSAGE = "No pudimos completar la solicitud.";

/** Customer app registers as a client; the backend ignores it for existing accounts (C1). */
const REGISTRATION_ROLE = "client" satisfies OtpVerifyRequest["registrationRole"];

const REFRESH_RESULT_REUSE_WINDOW_MS = 60_000;

type RefreshRequestEntry = {
  promise: Promise<RefreshSessionResult>;
  expiresAt: number | null;
};

// One refresh per refresh token. The backend revokes the whole token family
// when a rotated token is replayed, so concurrent callers must share one call.
const refreshRequestsByToken = new Map<string, RefreshRequestEntry>();

function pruneRefreshRequests(now: number) {
  for (const [token, entry] of refreshRequestsByToken) {
    if (entry.expiresAt !== null && entry.expiresAt <= now) {
      refreshRequestsByToken.delete(token);
    }
  }
}

let cachedBaseUrl: string | undefined;

function defaultBaseUrl() {
  cachedBaseUrl ??= resolveClientesApiBaseUrl({
    override: process.env.EXPO_PUBLIC_CLIENTES_API_URL,
    expoHostUri: Constants.expoConfig?.hostUri,
    isDevelopment: __DEV__,
  });
  return cachedBaseUrl;
}

const ELIGIBILITIES: readonly string[] = [
  "eligible",
  "birth_date_required",
  "underage",
];

function readEligibility(data: unknown): CustomerEligibility | undefined {
  const value = (data as AuthErrorResponse | null)?.details?.eligibility;
  return typeof value === "string" && ELIGIBILITIES.includes(value)
    ? (value as CustomerEligibility)
    : undefined;
}

function isCustomerProfile(value: unknown): value is CustomerProfile {
  const profile = value as Partial<CustomerProfile> | null;
  return (
    typeof profile === "object" &&
    profile !== null &&
    typeof profile.fullName === "string" &&
    (profile.birthDate === null || typeof profile.birthDate === "string") &&
    typeof profile.eligibility === "string" &&
    ELIGIBILITIES.includes(profile.eligibility)
  );
}

function otpFailureState(
  response: Response,
  data: Partial<AuthErrorResponse>,
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

const readJson = (response: Response) =>
  response.json().catch(() => ({})) as Promise<Record<string, any>>;

async function failure(
  response: Response,
  fallback: string,
): Promise<Extract<AuthRemoteResult<never>, { success: false }>> {
  const data = await readJson(response);
  const eligibility = readEligibility(data);
  return {
    success: false,
    // Server text is never shown to the customer.
    error: fallback,
    status: response.status,
    unauthorized: response.status === 401,
    ...(eligibility ? { eligibility } : {}),
  };
}

const networkFailure = {
  success: false as const,
  error: OFFLINE_MESSAGE,
  unauthorized: false,
};

type Options = { getBaseUrl?: () => string };

export function createAuthFetchRepository({
  getBaseUrl = defaultBaseUrl,
}: Options = {}): AuthRemoteRepository {
  const authorizedFetch = (
    accessToken: string,
    path: string,
    init: RequestInit = {},
  ) =>
    fetch(`${getBaseUrl()}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });

  return {
    async refreshSession(refreshToken) {
      pruneRefreshRequests(Date.now());
      const existing = refreshRequestsByToken.get(refreshToken);
      if (existing) return existing.promise;

      const refreshRequest = (async (): Promise<RefreshSessionResult> => {
        try {
          const response = await fetch(`${getBaseUrl()}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken }),
          });

          if (!response.ok) {
            return {
              success: false,
              error: REFRESH_MESSAGE,
              status: response.status,
              terminal: response.status === 400 || response.status === 401,
            };
          }

          const data = await readJson(response);
          if (!data.session?.accessToken) {
            return { success: false, error: REFRESH_MESSAGE, terminal: false };
          }
          return { success: true, session: data.session as AuthSession };
        } catch {
          return { success: false, error: OFFLINE_MESSAGE, terminal: false };
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
        if (!response.ok) return failure(response, REQUEST_MESSAGE);
        const data = await readJson(response);
        if (!data.user) return failure(response, REQUEST_MESSAGE);
        return { success: true, data: data.user as AuthUser };
      } catch {
        return networkFailure;
      }
    },

    async requestOtp(email) {
      try {
        const response = await fetch(`${getBaseUrl()}/auth/otp/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });

        if (!response.ok) {
          const data = (await readJson(response)) as Partial<AuthErrorResponse>;
          const headerRetryAfter = Number(response.headers.get("Retry-After"));
          return {
            success: false,
            state: otpFailureState(response, data, "provider_error"),
            retryAfterSeconds:
              (Number.isFinite(headerRetryAfter) && headerRetryAfter > 0
                ? headerRetryAfter
                : undefined) ?? data.details?.retryAfterSeconds,
            error: OTP_REQUEST_MESSAGE,
          };
        }

        const data = await readJson(response);
        if (!data.challengeId) {
          return {
            success: false,
            state: "provider_error",
            error: OTP_REQUEST_MESSAGE,
          };
        }
        return {
          success: true,
          state: "sent",
          challengeId: String(data.challengeId),
          cooldownSeconds: Number(data.cooldownSeconds) || 0,
        };
      } catch {
        return { success: false, state: "offline", error: OFFLINE_MESSAGE };
      }
    },

    async verifyOtp(email, challengeId, code) {
      try {
        const body: OtpVerifyRequest = {
          email,
          challengeId,
          token: code,
          registrationRole: REGISTRATION_ROLE,
        };
        const response = await fetch(`${getBaseUrl()}/auth/otp/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = (await readJson(response)) as Partial<AuthErrorResponse> & {
          user?: AuthUser;
          session?: AuthSession;
        };
        if (!response.ok) {
          return {
            success: false,
            state: otpFailureState(response, data, "incorrect_code"),
            retryAfterSeconds: data.details?.retryAfterSeconds,
            error: OTP_VERIFY_MESSAGE,
          };
        }
        if (!data.user || !data.session) {
          return {
            success: false,
            state: "provider_error",
            error: OTP_VERIFY_MESSAGE,
          };
        }

        return { success: true, user: data.user, session: data.session };
      } catch {
        return { success: false, state: "offline", error: OFFLINE_MESSAGE };
      }
    },

    async getProfile(accessToken) {
      try {
        const response = await authorizedFetch(
          accessToken,
          "/api/v1/clientes/profile",
        );
        if (!response.ok) return failure(response, REQUEST_MESSAGE);
        const data = await readJson(response);
        if (!isCustomerProfile(data.data)) {
          return failure(response, REQUEST_MESSAGE);
        }
        return { success: true, data: data.data };
      } catch {
        return networkFailure;
      }
    },

    async saveProfile(payload, accessToken) {
      try {
        const response = await authorizedFetch(
          accessToken,
          "/api/v1/clientes/profile",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fullName: payload.fullName,
              birthDate: payload.birthDate,
            }),
          },
        );
        if (!response.ok) return failure(response, REQUEST_MESSAGE);
        const data = await readJson(response);
        if (!isCustomerProfile(data.data)) {
          return failure(response, REQUEST_MESSAGE);
        }
        return { success: true, data: data.data };
      } catch {
        return networkFailure;
      }
    },

    async logout({ accessToken }) {
      await authorizedFetch(accessToken, "/auth/logout", { method: "POST" });
    },
  };
}
