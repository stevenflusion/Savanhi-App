import {
  isUploadableImage,
  putImageBytes,
  readLocalImage,
} from "@/src/lib/image-upload";

import type { CouponsRepository } from "../ports/coupons-repository";

export type UploadCouponImageDeps = {
  repository: CouponsRepository;
  /** Injected so the use case can be exercised without a filesystem. */
  readImage?: typeof readLocalImage;
  putBytes?: typeof putImageBytes;
};

export type UploadCouponImageResult =
  | { success: true; objectKey: string }
  | { success: false; error: string };

const UNREADABLE =
  "No se pudo leer la foto. Elige una imagen JPG, PNG o WEBP de hasta 5 MB.";
const UPLOAD_FAILED = "No se pudo subir la foto del cupón.";

/**
 * Uploads ONE coupon photo through the T4 presigned PUT and returns the object
 * key the create or update payload carries (S10).
 *
 * Every step is the shared one the onboarding store photos already use: the
 * same size and type guard, the same direct PUT to Garage with the two signed
 * headers. The bytes never travel through the API, whose JSON body parser caps
 * requests at 100kb.
 */
export async function uploadCouponImage({
  storeId,
  uri,
  deps,
}: {
  storeId: string;
  uri: string;
  deps: UploadCouponImageDeps;
}): Promise<UploadCouponImageResult> {
  const readImage = deps.readImage ?? readLocalImage;
  const putBytes = deps.putBytes ?? putImageBytes;

  try {
    const image = await readImage(uri);
    if (!isUploadableImage(image)) {
      return { success: false, error: UNREADABLE };
    }

    const ticket = await deps.repository.requestImageTicket(storeId, {
      contentType: image.contentType,
      contentLength: image.bytes.length,
    });
    if (!ticket.success) return { success: false, error: ticket.error };

    if (!(await putBytes(ticket.data, image.bytes))) {
      return { success: false, error: UPLOAD_FAILED };
    }

    return { success: true, objectKey: ticket.data.objectKey };
  } catch {
    return { success: false, error: UPLOAD_FAILED };
  }
}
