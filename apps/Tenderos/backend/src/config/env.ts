import { createEnv, createStorageEnv } from "@repo/backend-core";

export const env = createEnv({
  serviceName: "tenderos-backend",
  defaultPort: 4300,
});

/**
 * Object storage is validated here rather than inside `createEnv` so the
 * database migration and seed scripts keep running without Garage credentials.
 * A missing or malformed value still fails the backend at startup.
 */
export const storageEnv = createStorageEnv();
