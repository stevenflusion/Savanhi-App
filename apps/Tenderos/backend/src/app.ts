import {
  createAuthRouter,
  createBackendApp,
  createBackendContext,
  createObjectStorage,
} from "@repo/backend-core";
import { env, storageEnv } from "./config/env.js";
import { createApiRouter } from "./routes/index.js";

export function createApp() {
  const context = createBackendContext(env, {
    defaultRegistrationRole: "tendero",
  });
  const { authRouter, requireRole } = createAuthRouter(context.authService, {
    limits: context.env.rateLimits,
  });
  const storage = createObjectStorage(storageEnv);

  return createBackendApp({
    env,
    routers: [authRouter, createApiRouter({ context, requireRole, storage })],
  });
}
