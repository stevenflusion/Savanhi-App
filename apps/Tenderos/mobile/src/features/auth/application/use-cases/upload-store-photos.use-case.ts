import type {
  ImageContentType,
  ImageUploadTicket,
  ImageUploadTicketRequest,
  MaxImageBytes,
  StorePhotoRegisterRequest,
} from "@repo/api-contracts";

/**
 * `@repo/api-contracts` is ESM-only and Jest/Metro resolve CommonJS, so the
 * limit and the allowlist are restated here as values. The `MaxImageBytes` and
 * `ImageContentType` annotations make any drift from the backend contract a
 * type error.
 */
const MAX_IMAGE_BYTES: MaxImageBytes = 5_242_880;

const CONTENT_TYPE_BY_EXTENSION: Record<string, ImageContentType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const ALLOWED_CONTENT_TYPES: ImageContentType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export type LocalImage = {
  bytes: Uint8Array;
  contentType: ImageContentType;
};

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
 * Resolves the content type of a local image. The reported type wins when it is
 * in the allowlist, otherwise the file extension decides. Anything else is
 * refused here rather than at the presign endpoint.
 */
export function resolveImageContentType(
  uri: string,
  reportedContentType?: string | null,
): ImageContentType | null {
  const reported = reportedContentType?.split(";")[0]?.trim().toLowerCase();
  const allowed = ALLOWED_CONTENT_TYPES.find((type) => type === reported);
  if (allowed) return allowed;

  const path = uri.split("?")[0]?.split("#")[0] ?? "";
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return null;
  return CONTENT_TYPE_BY_EXTENSION[path.slice(lastDot + 1).toLowerCase()] ?? null;
}

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
      if (
        !image ||
        image.bytes.length === 0 ||
        image.bytes.length > MAX_IMAGE_BYTES ||
        !ALLOWED_CONTENT_TYPES.includes(image.contentType)
      ) {
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
