import type { AuthRemoteResult } from "@/src/features/auth";
import { defaultBaseUrl } from "@/src/features/auth/infrastructure/auth-fetch-repository";

import type { PushDeviceRepository } from "../application/ports";

const OFFLINE_MESSAGE =
  "No pudimos conectarnos con el servidor. Revisa tu conexión e intenta de nuevo.";
const REQUEST_MESSAGE = "No pudimos completar la solicitud.";
const PATH = "/api/v1/clientes/push-device";

type Options = { getBaseUrl?: () => string };

/**
 * PUT and DELETE `/api/v1/clientes/push-device`. The bearer token comes from
 * the auth layer's protected request; the Expo token travels only in the PUT
 * body and is never returned, logged or put in an error. Server text is never
 * shown: only the status survives.
 */
export function createPushDeviceFetchRepository({
  getBaseUrl = defaultBaseUrl,
}: Options = {}): PushDeviceRepository {
  async function send(
    accessToken: string,
    init: RequestInit,
  ): Promise<AuthRemoteResult<null>> {
    try {
      const response = await fetch(`${getBaseUrl()}${PATH}`, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
      });
      if (response.ok) return { success: true, data: null };
      return {
        success: false,
        error: REQUEST_MESSAGE,
        status: response.status,
        unauthorized: response.status === 401,
      };
    } catch {
      return { success: false, error: OFFLINE_MESSAGE, unauthorized: false };
    }
  }

  return {
    register: (accessToken, expoToken) =>
      send(accessToken, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expoToken }),
      }),
    remove: (accessToken) => send(accessToken, { method: "DELETE" }),
  };
}
