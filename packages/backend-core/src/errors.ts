import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";
import { ZodError } from "zod";
import type { BackendEnv } from "./types/env.js";

export class AppError extends Error {
  statusCode: number;
  details?: unknown;
  code?: string;

  constructor(
    message: string,
    statusCode = 500,
    details: unknown = undefined,
    code: string | undefined = undefined,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
  }
}

export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
}

export function createErrorHandler(env: BackendEnv): ErrorRequestHandler {
  return function errorHandler(error, _req, res, _next) {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: "Invalid request payload.",
        details: error.flatten(),
      });
      return;
    }

    const statusCode = Number.isInteger(error?.statusCode)
      ? error.statusCode
      : 500;
    if (statusCode === 429 && error?.details?.retryAfterSeconds)
      res.setHeader("Retry-After", String(error.details.retryAfterSeconds));
    const message =
      statusCode === 500 ? "Internal server error" : error.message;
    const payload: { error: string; code?: string; details?: unknown } = {
      error: message,
    };

    if (statusCode !== 500 && typeof error?.code === "string") {
      payload.code = error.code;
    }

    if (statusCode !== 500 && error?.details !== undefined) {
      payload.details = error.details;
    }

    if (env.nodeEnv !== "production" && statusCode === 500) {
      payload.details = error?.message ?? "Unknown error";
    }

    res.status(statusCode).json(payload);
  };
}
