import type {
  AuthErrorResponse,
  CustomerClaim,
  CustomerEligibility,
} from "@repo/api-contracts";

import type { AuthRemoteResult } from "@/src/features/auth";
import { defaultBaseUrl } from "@/src/features/auth/infrastructure/auth-fetch-repository";

import type { WalletRemoteRepository } from "../application/ports";
import { isCustomerClaim, isQrToken, withoutSecret } from "../domain/claim";

const OFFLINE_MESSAGE =
  "No pudimos conectarnos con el servidor. Revisa tu conexión e intenta de nuevo.";
const REQUEST_MESSAGE = "No pudimos completar la solicitud.";

const ELIGIBILITIES: readonly string[] = [
  "eligible",
  "birth_date_required",
  "underage",
];

type Options = { getBaseUrl?: () => string };
type Failure = Extract<AuthRemoteResult<never>, { success: false }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

/** Server text is never shown, so only the status and the eligibility code travel. */
async function failure(response: Response): Promise<Failure> {
  const body = await readJson(response);
  const code = isRecord(body)
    ? (body as AuthErrorResponse).details?.eligibility
    : undefined;
  const eligibility =
    typeof code === "string" && ELIGIBILITIES.includes(code)
      ? (code as CustomerEligibility)
      : undefined;
  return {
    success: false,
    error: REQUEST_MESSAGE,
    status: response.status,
    unauthorized: response.status === 401,
    ...(eligibility ? { eligibility } : {}),
  };
}

const networkFailure: Failure = {
  success: false,
  error: OFFLINE_MESSAGE,
  unauthorized: false,
};
const malformed = (response: Response): Failure => ({
  success: false,
  error: REQUEST_MESSAGE,
  status: response.status,
  unauthorized: false,
});

/**
 * The customer claim endpoints. Every call goes through the auth layer's
 * protected-request helper, which owns the bearer token; this repository only
 * builds the request and checks the shape of the answer. The two answers that
 * issue a token are accepted only with a usable one, because a claim whose
 * secret cannot be stored must never read as a success.
 */
export function createWalletFetchRepository({
  getBaseUrl = defaultBaseUrl,
}: Options = {}): WalletRemoteRepository {
  const authorizedFetch = (
    accessToken: string,
    path: string,
    init: RequestInit = {},
  ) =>
    fetch(`${getBaseUrl()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

  async function issued(
    accessToken: string,
    path: string,
  ): Promise<AuthRemoteResult<CustomerClaim>> {
    try {
      const response = await authorizedFetch(accessToken, path, {
        method: "POST",
      });
      if (!response.ok) return await failure(response);
      const body = await readJson(response);
      const data = isRecord(body) ? body.data : undefined;
      if (!isCustomerClaim(data) || !isQrToken(data.qrToken)) {
        return malformed(response);
      }
      return { success: true, data };
    } catch {
      return networkFailure;
    }
  }

  return {
    claimCoupon: (accessToken, couponId) =>
      issued(
        accessToken,
        `/api/v1/clientes/coupons/${encodeURIComponent(couponId)}/claims`,
      ),

    reissueQr: (accessToken, claimId) =>
      issued(
        accessToken,
        `/api/v1/clientes/claims/${encodeURIComponent(claimId)}/qr`,
      ),

    async listClaims(accessToken) {
      try {
        const response = await authorizedFetch(
          accessToken,
          "/api/v1/clientes/claims",
        );
        if (!response.ok) return await failure(response);
        const body = await readJson(response);
        const data = isRecord(body) ? body.data : undefined;
        if (!Array.isArray(data) || !data.every(isCustomerClaim)) {
          return malformed(response);
        }
        // The wallet never keeps a secret, even one the server should not send.
        return { success: true, data: data.map(withoutSecret) };
      } catch {
        return networkFailure;
      }
    },
  };
}
