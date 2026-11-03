import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type {
  OtpRequestResponse,
  OtpVerifyResponse,
} from "@repo/api-contracts/auth";
import type { Store } from "@repo/api-contracts/products";
import type { ImageUploadTicket, StorePhoto } from "@repo/api-contracts";
import {
  createAuthRouter,
  createBackendApp,
  createBackendContext,
  createDatabaseConnection,
  createObjectStorage,
  type BackendEnv,
  type StorageEnv,
} from "@repo/backend-core";
import { createApiRouter } from "./index.js";

const env: BackendEnv = {
  serviceName: "store-photos-garage-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "store-photos-garage-tests",
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

/** The committed development fixture from infra/garage/garage.toml. */
const storageEnv: StorageEnv = {
  endpoint: process.env.GARAGE_ENDPOINT ?? "http://127.0.0.1:3900",
  region: process.env.GARAGE_REGION ?? "garage",
  bucket: process.env.GARAGE_BUCKET ?? "savanhi-dev",
  accessKeyId: process.env.GARAGE_ACCESS_KEY_ID ?? "GK1a2b3c4d5e6f708192a3b4c5",
  secretAccessKey:
    process.env.GARAGE_SECRET_ACCESS_KEY ??
    "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  uploadUrlTtlSeconds: 900,
  readUrlTtlSeconds: 3600,
};

/** Deterministic stand-in for image bytes; Garage stores them verbatim. */
const IMAGE_BYTES = new Uint8Array(
  Array.from({ length: 64 }, (_, index) => (index * 7) % 256),
);

async function garageIsReachable() {
  try {
    await fetch(storageEnv.endpoint, { method: "GET" });
    return true;
  } catch {
    return false;
  }
}

test("a presigned PUT stores real bytes in Garage", async (t) => {
  if (!(await garageIsReachable())) {
    t.skip(
      `Garage is not reachable at ${storageEnv.endpoint}. Run "docker compose up -d garage && ./scripts/garage-bootstrap.sh".`,
    );
    return;
  }

  const context = createBackendContext(env, {
    defaultRegistrationRole: "tendero",
  });
  const { authRouter, requireRole } = createAuthRouter(context.authService, {
    limits: context.env.rateLimits,
  });
  const storage = createObjectStorage(storageEnv);
  const server = createBackendApp({
    env,
    routers: [authRouter, createApiRouter({ context, requireRole, storage })],
  }).listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const cleanupDb = createDatabaseConnection(env);
  const runId = randomUUID();
  const email = `store-photos-garage-${runId}@example.test`;
  const uploadedKeys: string[] = [];
  let userId: string | null = null;
  let requestSequence = 0;

  t.after(async () => {
    for (const objectKey of uploadedKeys) {
      await storage.deleteImage(objectKey).catch(() => undefined);
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await storage.destroy();
    await context.db.pool.end();
    if (userId) {
      await cleanupDb.pool.query(
        "delete from stores where owner_user_id = $1",
        [userId],
      );
      await cleanupDb.pool.query("delete from users where id = $1", [userId]);
    }
    await cleanupDb.pool.query(
      "delete from otp_request_leases where email_normalized = $1",
      [email],
    );
    await cleanupDb.pool.query(
      "delete from otp_challenges where email_normalized = $1",
      [email],
    );
    await cleanupDb.pool.query(
      "delete from auth_events where request_id like $1",
      [`store-photos-garage-${runId}-%`],
    );
    await cleanupDb.pool.end();
  });

  const call = (
    method: string,
    path: string,
    { body, token }: { body?: object; token?: string } = {},
  ) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-request-id": `store-photos-garage-${runId}-${requestSequence++}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const requested = await call("POST", "/auth/otp/request", { body: { email } });
  const { challengeId } = (await requested.json()) as OtpRequestResponse;
  const verified = await call("POST", "/auth/otp/verify", {
    body: { email, challengeId, token: "123456" },
  });
  const session = (await verified.json()) as OtpVerifyResponse;
  const token = session.session.accessToken;
  userId = session.user.id;

  const createdStore = await call("POST", "/api/v1/tenderos/stores", {
    token,
    body: { name: "Tienda Garage" },
  });
  const storeId = ((await createdStore.json()) as { data: Store }).data.id;

  const askForTicket = async () => {
    const response = await call(
      "POST",
      `/api/v1/tenderos/stores/${storeId}/photo-uploads`,
      {
        token,
        body: { contentType: "image/png", contentLength: IMAGE_BYTES.length },
      },
    );
    assert.equal(response.status, 201);
    const ticket = ((await response.json()) as { data: ImageUploadTicket })
      .data;
    uploadedKeys.push(ticket.objectKey);
    return ticket;
  };

  await t.test("the signed byte count is the only one Garage accepts", async () => {
    const ticket = await askForTicket();
    const tooMany = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": "image/png",
        "content-length": String(IMAGE_BYTES.length + 1),
      },
      body: new Uint8Array([...IMAGE_BYTES, 0]),
    });
    assert.equal(tooMany.ok, false);
  });

  await t.test(
    "the bytes land in the bucket and come back through stores/me",
    async () => {
      const ticket = await askForTicket();

      const uploaded = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: {
          "content-type": ticket.contentType,
          "content-length": String(ticket.contentLength),
        },
        body: IMAGE_BYTES,
      });
      assert.equal(uploaded.status, 200, await uploaded.text());

      const registered = await call(
        "POST",
        `/api/v1/tenderos/stores/${storeId}/photos`,
        {
          token,
          body: {
            objectKey: ticket.objectKey,
            contentType: ticket.contentType,
            byteSize: ticket.contentLength,
          },
        },
      );
      assert.equal(registered.status, 201);

      const mine = await call("GET", "/api/v1/tenderos/stores/me", { token });
      const stores = ((await mine.json()) as {
        data: (Store & { photos: StorePhoto[] })[];
      }).data;
      const photo = stores.find((store) => store.id === storeId)?.photos[0];
      assert.ok(photo, "stores/me must expose the registered photo");

      const downloaded = await fetch(photo.url);
      assert.equal(downloaded.status, 200);
      assert.equal(downloaded.headers.get("content-type"), "image/png");
      assert.deepEqual(
        new Uint8Array(await downloaded.arrayBuffer()),
        IMAGE_BYTES,
      );
    },
  );
});
