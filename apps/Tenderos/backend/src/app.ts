import {
  createAuthRouter,
  createBackendApp,
  createBackendContext,
} from "@repo/backend-core";
import { env } from "./config/env.js";
import { createApiRouter } from "./routes/index.js";

export function createApp() {
  const context = createBackendContext(env, {
    defaultRegistrationRole: "tendero",
  });
  const { authRouter, requireRole } = createAuthRouter(context.authService, {
    limits: context.env.rateLimits,
  });

  return createBackendApp({
    env,
    routers: [authRouter, createApiRouter({ context, requireRole })],
  });
}
