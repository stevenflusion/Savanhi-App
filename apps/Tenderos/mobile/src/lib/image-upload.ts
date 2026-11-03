import type { ImageContentType, ImageUploadTicket, MaxImageBytes } from "@repo/api-contracts";

/**
 * The image-upload primitives shared by every presigned-PUT path in the app:
 * the onboarding store photos (T2) and the coupon photo (T8). They live here
 * rather than inside one feature because both features upload the tendero's own
 * images through the same two steps — a ticket from the backend, then the bytes
 * straight to Garage — and two copies of the size guard or of the signed
 * headers would drift.
 *
 * `@repo/api-contracts` is ESM-only and Jest/Metro resolve CommonJS, so the
 * limit and the allowlist are restated here as values. The `MaxImageBytes` and
 * `ImageContentType` annotations make any drift from the backend contract a
 * type error.
 */
export const MAX_IMAGE_BYTES: MaxImageBytes = 5_242_880;

const CONTENT_TYPE_BY_EXTENSION: Record<string, ImageContentType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const ALLOWED_IMAGE_CONTENT_TYPES: ImageContentType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export type LocalImage = {
  bytes: Uint8Array;
  contentType: ImageContentType;
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
  const allowed = ALLOWED_IMAGE_CONTENT_TYPES.find((type) => type === reported);
  if (allowed) return allowed;

  const path = uri.split("?")[0]?.split("#")[0] ?? "";
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return null;
  return CONTENT_TYPE_BY_EXTENSION[path.slice(lastDot + 1).toLowerCase()] ?? null;
}

/**
 * Whether an image is worth asking a ticket for. An empty, oversized or
 * disallowed image is refused on the device, so the presign endpoint is never
 * called for bytes it would reject anyway.
 */
export function isUploadableImage(
  image: LocalImage | null | undefined,
): image is LocalImage {
  return (
    !!image &&
    image.bytes.length > 0 &&
    image.bytes.length <= MAX_IMAGE_BYTES &&
    ALLOWED_IMAGE_CONTENT_TYPES.includes(image.contentType)
  );
}

/** Reads the picker's local URI. Returns null when it is gone or unusable. */
export async function readLocalImage(uri: string): Promise<LocalImage | null> {
  try {
    const response = await fetch(uri);
    if (!response.ok) return null;
    const contentType = resolveImageContentType(
      uri,
      response.headers.get("content-type"),
    );
    if (!contentType) return null;
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType,
    };
  } catch {
    return null;
  }
}

/**
 * The bytes go straight to Garage, never through the API: the backend's JSON
 * body parser caps requests at 100kb. The signature covers the exact content
 * type and byte count the ticket was issued for, so both headers must be sent
 * verbatim.
 */
export async function putImageBytes(
  ticket: ImageUploadTicket,
  bytes: Uint8Array,
): Promise<boolean> {
  try {
    const response = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": ticket.contentType,
        "Content-Length": String(ticket.contentLength),
      },
      body: bytes as unknown as BodyInit,
    });
    return response.ok;
  } catch {
    return false;
  }
}
