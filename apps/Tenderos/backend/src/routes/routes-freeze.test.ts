import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  createAuthRouter,
  createBackendApp,
  createBackendContext,
} from "@repo/backend-core";
import type { BackendEnv } from "@repo/backend-core";
import { createApiRouter } from "./index.js";

const env: BackendEnv = {
  serviceName: "routes-freeze-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "routes-freeze-tests",
  authJwtAudience: "savanhi-api",
  trustProxy: false,
  otpProvider: "development",
  otpDevCode: "123456",
  rateLimits: {
    api: 10_000,
    otpRequest: 10_000,
    otpVerify: 10_000,
    refresh: 10_000,
  },
};

/**
 * These cases only exercise routing and authentication, so no request ever
 * reaches a repository and the PostgreSQL pool stays idle.
 */
async function startHarness() {
  const context = createBackendContext(env, {
    defaultRegistrationRole: "tendero",
  });
  const { authRouter, requireRole } = createAuthRouter(context.authService, {
    limits: context.env.rateLimits,
  });
  const server = createBackendApp({
    env,
    routers: [authRouter, createApiRouter({ context, requireRole })],
  }).listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await context.db.pool.end();
    },
  };
}

test("frozen order routes and live product routes", async (t) => {
  const harness = await startHarness();
  t.after(() => harness.close());

  const call = (method: string, path: string, body?: object) =>
    fetch(`${harness.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-request-id": `routes-freeze-${randomUUID()}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  await t.test("the orders routes are unmounted", async () => {
    const list = await call("GET", "/api/v1/tenderos/orders");
    assert.equal(list.status, 404);

    const update = await call(
      "PATCH",
      `/api/v1/tenderos/orders/${randomUUID()}/status`,
      { status: "accepted" },
    );
    assert.equal(update.status, 404);
  });

  await t.test("the tendero status route still answers", async () => {
    const response = await call("GET", "/api/v1/tenderos/status");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      section: "Tenderos",
      backend: "tenderos-backend",
      status: "ready",
    });
  });

  await t.test(
    "the product routes stay mounted behind authentication",
    async () => {
      for (const [method, path] of [
        ["GET", "/api/v1/tenderos/products"],
        ["POST", "/api/v1/tenderos/products"],
        ["GET", `/api/v1/tenderos/stores/${randomUUID()}/products`],
        ["POST", `/api/v1/tenderos/stores/${randomUUID()}/products`],
      ] as const) {
        const response = await call(
          method,
          path,
          method === "GET" ? undefined : { name: "Rice", price: 2 },
        );
        assert.notEqual(response.status, 404);
        assert.equal(response.status, 401);
      }
    },
  );
});

test("a store product payload no longer carries a brand reference", async () => {
  const { storeProductCreateSchema, storeProductUpdateSchema } = await import(
    "@repo/api-contracts/catalog"
  );

  const created = storeProductCreateSchema.safeParse({
    name: "Rice",
    price: 2,
  });
  assert.equal(created.success, true);
  assert.equal("brandId" in (created.data ?? {}), false);

  assert.equal(
    storeProductCreateSchema.safeParse({
      name: "Rice",
      price: 2,
      brandId: randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    storeProductUpdateSchema.safeParse({ brandId: randomUUID() }).success,
    false,
  );
  assert.equal(storeProductUpdateSchema.safeParse({ name: "Rice" }).success, true);
});
