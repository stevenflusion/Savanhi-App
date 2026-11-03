import type {
  ImageUploadTicket,
  ImageUploadTicketRequest,
  StorePhotoRegisterRequest,
} from "@repo/api-contracts";

import { isUploadableImage, type LocalImage } from "@/src/lib/image-upload";

/**
 * The content-type resolution, the size guard and the allowlist moved to
 * `src/lib/image-upload` when the coupon photo (T8) started uploading through
 * the same presigned-PUT path. They are re-exported here so this use case keeps
 * the surface its callers and its suite already use.
 */
export { resolveImageContentType } from "@/src/lib/image-upload";
export type { LocalImage } from "@/src/lib/image-upload";

export type UploadStorePhotosDeps = {
  /** Reads the picker's local URI. Returns null when it is gone or unusable. */
  readLocalImage: (uri: string) => Promise<LocalImage | null>;
  requestUploadTicket: (
    storeId: string,
    request: ImageUploadTicketRequest,
  ) => Promise<ImageUploadTicket | null>;
  uploadBytes: (
    ticket: ImageUploadTicket,
    bytes: Uint8Array,
  ) => Promise<boolean>;
  registerPhoto: (
    storeId: string,
    request: StorePhotoRegisterRequest,
  ) => Promise<boolean>;
};

export type UploadStorePhotosResult = {
  /** Local URIs whose bytes are now in the bucket and registered. */
  uploaded: string[];
  failed: string[];
};

/**
 * Uploads onboarding store photos through presigned PUT URLs and registers the
 * resulting object references, one at a time and in the given order so the
 * backend's stored position matches what the tendero arranged on screen.
 *
 * A photo that cannot be uploaded is reported, never thrown: the onboarding
 * step must not strand the tendero because one slot failed.
 */
export async function uploadStorePhotos({
  storeId,
  uris,
  deps,
}: {
  storeId: string;
  uris: string[];
  deps: UploadStorePhotosDeps;
}): Promise<UploadStorePhotosResult> {
  const uploaded: string[] = [];
  const failed: string[] = [];

  for (const uri of uris) {
    try {
      const image = await deps.readLocalImage(uri);
      if (!isUploadableImage(image)) {
        failed.push(uri);
        continue;
      }

      const ticket = await deps.requestUploadTicket(storeId, {
        contentType: image.contentType,
        contentLength: image.bytes.length,
      });
      if (!ticket) {
        failed.push(uri);
        continue;
      }

      if (!(await deps.uploadBytes(ticket, image.bytes))) {
        failed.push(uri);
        continue;
      }

      const registered = await deps.registerPhoto(storeId, {
        objectKey: ticket.objectKey,
        contentType: ticket.contentType,
        byteSize: ticket.contentLength,
      });
      if (!registered) {
        failed.push(uri);
        continue;
      }

      uploaded.push(uri);
    } catch {
      failed.push(uri);
    }
  }

  return { uploaded, failed };
}
