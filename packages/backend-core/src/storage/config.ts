/**
 * Object storage (Garage, S3-compatible) configuration.
 *
 * Validated eagerly at startup, the same way `createEnv` validates
 * `DATABASE_URL` and `AUTH_JWT_SECRET`: a missing or malformed value throws
 * before the process starts serving. It is deliberately a separate factory so
 * the migration and seed scripts, which only need a database, keep booting
 * without object storage credentials.
 */
export type StorageEnv = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Base URL that serves the bucket's objects to clients. Leave it unset when
   * no CDN or proxy fronts the bucket; readers then get short-lived presigned
   * GET URLs instead.
   */
  publicBaseUrl?: string;
  uploadUrlTtlSeconds: number;
  readUrlTtlSeconds: number;
};

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseAbsoluteUrl(name: string, raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must be an absolute http(s) URL.`);
  }
  return raw.replace(/\/+$/, "");
}

function parseTtl(name: string, raw: string | undefined, fallback: number) {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer of seconds.`);
  }
  return value;
}

function parseBucket(raw: string): string {
  // S3 bucket naming, which Garage also enforces on creation.
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(raw)) {
    throw new Error(
      "GARAGE_BUCKET must be a valid S3 bucket name (lowercase letters, digits, dots and dashes).",
    );
  }
  return raw;
}

export function createStorageEnv(): StorageEnv {
  const endpoint = parseAbsoluteUrl(
    "GARAGE_ENDPOINT",
    readRequiredEnv("GARAGE_ENDPOINT"),
  );
  const rawPublicBaseUrl = process.env.GARAGE_PUBLIC_BASE_URL?.trim();

  return {
    endpoint,
    region: readRequiredEnv("GARAGE_REGION"),
    bucket: parseBucket(readRequiredEnv("GARAGE_BUCKET")),
    accessKeyId: readRequiredEnv("GARAGE_ACCESS_KEY_ID"),
    secretAccessKey: readRequiredEnv("GARAGE_SECRET_ACCESS_KEY"),
    publicBaseUrl: rawPublicBaseUrl
      ? parseAbsoluteUrl("GARAGE_PUBLIC_BASE_URL", rawPublicBaseUrl)
      : undefined,
    uploadUrlTtlSeconds: parseTtl(
      "GARAGE_UPLOAD_URL_TTL_SECONDS",
      process.env.GARAGE_UPLOAD_URL_TTL_SECONDS,
      900,
    ),
    readUrlTtlSeconds: parseTtl(
      "GARAGE_READ_URL_TTL_SECONDS",
      process.env.GARAGE_READ_URL_TTL_SECONDS,
      3600,
    ),
  };
}
