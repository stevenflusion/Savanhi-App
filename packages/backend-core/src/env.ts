import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BackendEnv } from "./types/env.js";

function loadEnvFiles(startDir = process.cwd()): void {
  const envFiles: string[] = [];
  let currentDir = startDir;

  // Walk UP from cwd to root, collecting .env files
  while (true) {
    const envFile = join(currentDir, ".env");
    if (existsSync(envFile)) envFiles.push(envFile);

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  // Load from ROOT down to cwd, so cwd's .env loads LAST and wins
  for (const envFile of envFiles.reverse()) {
    dotenv.config({ path: envFile, override: true });
  }
}

loadEnvFiles();

function parsePort(rawPort: string | undefined, defaultPort: number): number {
  const parsedPort = Number(rawPort ?? defaultPort);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    throw new Error("Invalid PORT value. It must be a positive integer.");
  }
  return parsedPort;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseOrigins(rawOrigins: string | undefined): string[] {
  if (!rawOrigins) return [];
  return rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseLimit(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error("Rate limits must be positive integers.");
  return value;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error("Expected a boolean environment value.");
}

function parseTimeout(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("OTP provider timeout must be a positive integer.");
  }
  return value;
}

export function createEnv({
  serviceName,
  defaultPort,
}: {
  serviceName: string;
  defaultPort: number;
}): BackendEnv {
  const rawOtpProvider = process.env.OTP_PROVIDER ?? "development";
  if (rawOtpProvider !== "development" && rawOtpProvider !== "resend") {
    throw new Error("OTP_PROVIDER must be either development or resend.");
  }
  const otpProvider = rawOtpProvider;
  const otpResend =
    otpProvider === "resend"
      ? {
          apiKey: readRequiredEnv("RESEND_API_KEY"),
          from: readRequiredEnv("RESEND_FROM"),
          timeoutMs: parseTimeout(process.env.RESEND_TIMEOUT_MS, 5000),
        }
      : undefined;

  return {
    serviceName,
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: parsePort(process.env.PORT, defaultPort),
    allowedOrigins: parseOrigins(process.env.CORS_ORIGINS),
    databaseUrl: readRequiredEnv("DATABASE_URL"),
    authJwtSecret: readRequiredEnv("AUTH_JWT_SECRET"),
    authJwtIssuer: process.env.AUTH_JWT_ISSUER ?? serviceName,
    authJwtAudience: process.env.AUTH_JWT_AUDIENCE ?? "savanhi-api",
    trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
    otpProvider,
    otpResend,
    otpDevCode:
      process.env.NODE_ENV === "production"
        ? undefined
        : process.env.OTP_DEV_CODE,
    rateLimits: {
      api: parseLimit(process.env.RATE_LIMIT_API, 120),
      otpRequest: parseLimit(process.env.RATE_LIMIT_OTP_REQUEST, 5),
      otpVerify: parseLimit(process.env.RATE_LIMIT_OTP_VERIFY, 10),
      refresh: parseLimit(process.env.RATE_LIMIT_REFRESH, 30),
    },
  };
}
