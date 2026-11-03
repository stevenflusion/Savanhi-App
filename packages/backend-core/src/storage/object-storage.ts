import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  IMAGE_CONTENT_TYPE_EXTENSIONS,
  MAX_IMAGE_BYTES,
  type ImageContentType,
  type ImageScope,
  type ImageUploadTicket,
} from "@repo/api-contracts";
import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import type { StorageEnv } from "./config.js";

/**
 * Content-Type and Content-Length are signed into the presigned PUT instead of
 * being hoisted into the query string, so Garage rejects an upload whose type
 * or byte count differs from the one the backend approved.
 */
const SIGNED_UPLOAD_HEADERS = new Set([
  "host",
  "content-type",
  "content-length",
]);

export type ImageOwner = {
  scope: ImageScope;
  ownerId: string;
};

/** `stores/<storeId>/` — the only prefix a store's own images may live under. */
export function buildImageKeyPrefix({ scope, ownerId }: ImageOwner): string {
  return `${scope}/${ownerId}/`;
}

/**
 * The exact shape `buildImageKey` produces. Matching it before the prefix check
 * is what rejects a traversal such as `stores/<mine>/../<yours>/x.jpg`, which
 * does start with the caller's own prefix.
 */
const GENERATED_IMAGE_KEY =
  /^[a-z]+\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

export function isImageKeyOwnedBy(objectKey: string, owner: ImageOwner) {
  return (
    GENERATED_IMAGE_KEY.test(objectKey) &&
    objectKey.startsWith(buildImageKeyPrefix(owner))
  );
}

export type ObjectStorage = ReturnType<typeof createObjectStorage>;

export function createObjectStorage(config: StorageEnv) {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // Garage serves path-style requests; virtual-host style needs DNS per bucket.
    forcePathStyle: true,
    // The SDK otherwise signs an `x-amz-checksum-crc32` of an empty body into
    // the presigned PUT, and Garage then rejects the real bytes with
    // `InvalidDigest`. The client computes the body checksum, not the signer.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  /**
   * Object keys are always generated here. A client-supplied key would let one
   * tendero write into another tendero's prefix.
   */
  function buildImageKey(owner: ImageOwner, contentType: ImageContentType) {
    const extension = IMAGE_CONTENT_TYPE_EXTENSIONS[contentType];
    return `${buildImageKeyPrefix(owner)}${randomUUID()}.${extension}`;
  }

  return {
    buildImageKey,

    async createImageUploadTicket({
      owner,
      contentType,
      contentLength,
    }: {
      owner: ImageOwner;
      contentType: ImageContentType;
      contentLength: number;
    }): Promise<ImageUploadTicket> {
      if (!Number.isInteger(contentLength) || contentLength <= 0) {
        throw new AppError("Image size must be a positive byte count.", 400);
      }
      if (contentLength > MAX_IMAGE_BYTES) {
        throw new AppError(
          `Image exceeds the ${MAX_IMAGE_BYTES} byte limit.`,
          413,
        );
      }

      const objectKey = buildImageKey(owner, contentType);
      const uploadUrl = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
          ContentType: contentType,
          ContentLength: contentLength,
        }),
        {
          expiresIn: config.uploadUrlTtlSeconds,
          signableHeaders: SIGNED_UPLOAD_HEADERS,
        },
      );

      return {
        objectKey,
        uploadUrl,
        contentType,
        contentLength,
        expiresInSeconds: config.uploadUrlTtlSeconds,
      };
    },

    /**
     * A public base URL wins when the deployment fronts the bucket with a CDN
     * or proxy. Otherwise readers get a short-lived presigned GET, because a
     * Garage bucket is not anonymously readable.
     */
    async buildReadUrl(objectKey: string): Promise<string> {
      if (config.publicBaseUrl) {
        return `${config.publicBaseUrl}/${objectKey}`;
      }

      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
        { expiresIn: config.readUrlTtlSeconds },
      );
    },

    /** Removes the bytes behind a key. The caller owns the database row. */
    async deleteImage(objectKey: string) {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }),
      );
    },

    async destroy() {
      client.destroy();
    },
  };
}
