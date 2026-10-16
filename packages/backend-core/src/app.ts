import cors from "cors";
import express, { type Express, type Router } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { createErrorHandler, notFoundHandler } from "./errors.js";
import { createHealthRouter } from "./health-router.js";
import type { BackendEnv } from "./types/env.js";
import { requestContext } from "./middleware/request-context.js";
import { createMemoryRateLimiter, rateLimit } from "./middleware/rate-limit.js";

function buildCorsOptions(env: BackendEnv): cors.CorsOptions | undefined {
  if (!env.allowedOrigins.length) return undefined;

  return {
    origin(origin, callback) {
      if (!origin || env.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
  };
}

export function createBackendApp({
  env,
  routers = [],
}: {
  env: BackendEnv;
  routers?: Router[];
}): Express {
  const app = express();
  app.set("trust proxy", env.trustProxy);

  app.use(helmet());
  app.use(cors(buildCorsOptions(env)));
  app.use(requestContext);
  app.use(express.json({ limit: "100kb" }));
  app.use(rateLimit(createMemoryRateLimiter(), "api", env.rateLimits.api));
  app.use(
    morgan(
      "[http] :remote-addr :method :url :status :response-time ms - :user-agent",
    ),
  );

  app.use(createHealthRouter(env));
  routers.forEach((router) => app.use(router));
  app.use(notFoundHandler);
  app.use(createErrorHandler(env));

  return app;
}
