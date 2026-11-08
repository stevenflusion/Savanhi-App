import type {
  AuthErrorResponse,
  CustomerCouponFeedItem,
  CustomerEligibility,
  CustomerStore,
} from "@repo/api-contracts";

import type { AuthRemoteResult } from "@/src/features/auth";
import { defaultBaseUrl } from "@/src/features/auth/infrastructure/auth-fetch-repository";

import type {
  DiscoveryRemoteRepository,
  FollowState,
} from "../application/ports";

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
const isNullable = (value: unknown, type: "string" | "number") =>
  value === null || typeof value === type;

function isFeedItem(value: unknown): value is CustomerCouponFeedItem {
  if (!isRecord(value)) return false;
  const { coupon, store } = value;
  return (
    isRecord(coupon) &&
    typeof coupon.id === "string" &&
    typeof coupon.title === "string" &&
    isNullable(coupon.description, "string") &&
    isNullable(coupon.freeText, "string") &&
    isNullable(coupon.percentageValue, "number") &&
    isNullable(coupon.fixedAmountValue, "number") &&
    typeof coupon.validFrom === "string" &&
    typeof coupon.validTo === "string" &&
    typeof coupon.remainingStock === "number" &&
    isRecord(store) &&
    typeof store.id === "string" &&
    typeof store.name === "string" &&
    isNullable(store.address, "string") &&
    isNullable(store.distanceMeters, "number") &&
    isNullable(store.distanceKm, "number") &&
    typeof value.followed === "boolean" &&
    typeof value.claimed === "boolean"
  );
}

function isStore(value: unknown): value is CustomerStore {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isNullable(value.address, "string")
  );
}

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
 * The customer discovery endpoints. Every call is made through the auth
 * layer's protected-request helper, which owns the bearer token, so this
 * repository only builds the request and checks the shape of the answer.
 */
export function createDiscoveryFetchRepository({
  getBaseUrl = defaultBaseUrl,
}: Options = {}): DiscoveryRemoteRepository {
  const authorizedFetch = (
    accessToken: string,
    path: string,
    init: RequestInit = {},
  ) =>
    fetch(`${getBaseUrl()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

  return {
    async getFeed(accessToken) {
      try {
        const response = await authorizedFetch(
          accessToken,
          "/api/v1/clientes/coupons/feed",
        );
        if (!response.ok) return await failure(response);
        const body = await readJson(response);
        const data = isRecord(body) ? body.data : undefined;
        if (!Array.isArray(data) || !data.every(isFeedItem)) {
          return malformed(response);
        }
        return { success: true, data };
      } catch {
        return networkFailure;
      }
    },

    async getFollowedStores(accessToken) {
      try {
        const response = await authorizedFetch(
          accessToken,
          "/api/v1/clientes/stores/followed",
        );
        if (!response.ok) return await failure(response);
        const body = await readJson(response);
        const data = isRecord(body) ? body.data : undefined;
        if (!Array.isArray(data) || !data.every(isStore)) {
          return malformed(response);
        }
        return { success: true, data };
      } catch {
        return networkFailure;
      }
    },

    async setFollow(accessToken, storeId, following) {
      try {
        const response = await authorizedFetch(
          accessToken,
          `/api/v1/clientes/stores/${encodeURIComponent(storeId)}/follow`,
          { method: following ? "PUT" : "DELETE" },
        );
        if (!response.ok) return await failure(response);
        const body = await readJson(response);
        const data = isRecord(body) ? body.data : undefined;
        if (
          !isRecord(data) ||
          data.storeId !== storeId ||
          typeof data.following !== "boolean"
        ) {
          return malformed(response);
        }
        const confirmed: FollowState = {
          storeId,
          following: data.following,
        };
        return { success: true, data: confirmed };
      } catch {
        return networkFailure;
      }
    },
  };
}
