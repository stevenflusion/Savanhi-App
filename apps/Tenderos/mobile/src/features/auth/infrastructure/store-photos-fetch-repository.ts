import type {
  ImageUploadTicket,
  ImageUploadTicketRequest,
  StorePhoto,
  StorePhotoRegisterRequest,
} from "@repo/api-contracts";
import type { Store } from "@repo/api-contracts/products";

import { putImageBytes, readLocalImage } from "@/src/lib/image-upload";

import type { UploadStorePhotosDeps } from "../application/use-cases/upload-store-photos.use-case";

/**
 * The authenticated JSON caller the AuthProvider already owns. It refreshes
 * the access token and surfaces a typed failure instead of throwing.
 */
export type AuthenticatedJsonRequest = (
  path: string,
  init?: RequestInit,
) => Promise<
  { success: true; response: Response } | { success: false; error: string }
>;

export type StoreWithPhotos = Store & { photos: StorePhoto[] };

/** The tendero's own store, or null when registration has not created one. */
export async function fetchOwnStoreId(
  request: AuthenticatedJsonRequest,
): Promise<string | null> {
  const outcome = await request("/api/v1/tenderos/stores/me");
  if (!outcome.success) return null;
  try {
    const body = (await outcome.response.json()) as { data?: StoreWithPhotos[] };
    return body.data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

export function createStorePhotosUploadDeps(
  request: AuthenticatedJsonRequest,
): UploadStorePhotosDeps {
  return {
    readLocalImage,

    async requestUploadTicket(
      storeId: string,
      payload: ImageUploadTicketRequest,
    ): Promise<ImageUploadTicket | null> {
      const outcome = await request(
        `/api/v1/tenderos/stores/${storeId}/photo-uploads`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!outcome.success) return null;
      try {
        return ((await outcome.response.json()) as { data: ImageUploadTicket })
          .data;
      } catch {
        return null;
      }
    },

    uploadBytes: putImageBytes,

    async registerPhoto(storeId: string, payload: StorePhotoRegisterRequest) {
      const outcome = await request(
        `/api/v1/tenderos/stores/${storeId}/photos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      return outcome.success;
    },
  };
}
