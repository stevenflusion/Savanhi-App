import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { OtpRequestResponse, OtpVerifyResponse } from "@repo/api-contracts/auth";
import type { Store } from "@repo/api-contracts/products";
import {
  MAX_IMAGE_BYTES,
  type ImageUploadTicket,
  type StorePhoto,
} from "@repo/api-contracts";
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
  serviceName: "store-photos-tests",
  nodeEnv: "test",
  port: 1,
  allowedOrigins: [],
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://savanhi:savanhi@localhost:5433/savanhi",
  authJwtSecret: "test-secret-that-is-long-enough",
  authJwtIssuer: "store-photos-tests",
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

async function startHarness() {
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
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await storage.destroy();
      await context.db.pool.end();
    },
  };
}

test("tendero store photo uploads are owner scoped and server keyed", async (t) => {
  const harness = await startHarness();
  const cleanupDb = createDatabaseConnection(env);
  const runId = randomUUID();
  const emails: string[] = [];
  const userIds: string[] = [];
  let requestSequence = 0;

  t.after(async () => {
    await harness.close();
    for (const userId of userIds) {
      // store_photos cascades with the store it belongs to.
      await cleanupDb.pool.query(
        "delete from stores where owner_user_id = $1",
        [userId],
      );
      await cleanupDb.pool.query("delete from users where id = $1", [userId]);
    }
    if (emails.length > 0) {
      await cleanupDb.pool.query(
        "delete from otp_request_leases where email_normalized = any($1::text[])",
        [emails],
      );
      await cleanupDb.pool.query(
        "delete from otp_challenges where email_normalized = any($1::text[])",
        [emails],
      );
    }
    await cleanupDb.pool.query(
      "delete from auth_events where request_id like $1",
      [`store-photos-${runId}-%`],
    );
    await cleanupDb.pool.end();
  });

  const call = (
    method: string,
    path: string,
    { body, token }: { body?: object; token?: string } = {},
  ) =>
    fetch(`${harness.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-request-id": `store-photos-${runId}-${requestSequence++}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Signs a tendero in through the real OTP flow and gives them one store. */
  const createTendero = async (label: string) => {
    const email = `store-photos-${label}-${runId}@example.test`;
    emails.push(email);

    const requested = await call("POST", "/auth/otp/request", {
      body: { email },
    });
    assert.equal(requested.status, 200);
    const { challengeId } = (await requested.json()) as OtpRequestResponse;

    const verified = await call("POST", "/auth/otp/verify", {
      body: { email, challengeId, token: "123456" },
    });
    assert.equal(verified.status, 200);
    const session = (await verified.json()) as OtpVerifyResponse;
    const token = session.session.accessToken;
    userIds.push(session.user.id);

    const created = await call("POST", "/api/v1/tenderos/stores", {
      token,
      body: { name: `Tienda ${label}` },
    });
    assert.equal(created.status, 201);
    const store = ((await created.json()) as { data: Store }).data;

    return { token, storeId: store.id };
  };

  const listMyStores = async (token: string) => {
    const response = await call("GET", "/api/v1/tenderos/stores/me", { token });
    assert.equal(response.status, 200);
    return ((await response.json()) as {
      data: (Store & { photos: StorePhoto[] })[];
    }).data;
  };

  const owner = await createTendero("owner");
  const intruder = await createTendero("intruder");

  await t.test("an anonymous caller cannot request an upload ticket", async () => {
    const response = await call(
      "POST",
      `/api/v1/tenderos/stores/${owner.storeId}/photo-uploads`,
      { body: { contentType: "image/jpeg", contentLength: 1024 } },
    );
    assert.equal(response.status, 401);
  });

  await t.test("an anonymous caller cannot register a photo", async () => {
    const response = await call(
      "POST",
      `/api/v1/tenderos/stores/${owner.storeId}/photos`,
      {
        body: {
          objectKey: `stores/${owner.storeId}/${randomUUID()}.jpg`,
          contentType: "image/jpeg",
          byteSize: 1024,
        },
      },
    );
    assert.equal(response.status, 401);
  });

  await t.test(
    "a tendero cannot touch another tendero's store photos",
    async () => {
      const ticket = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/photo-uploads`,
        {
          token: intruder.token,
          body: { contentType: "image/jpeg", contentLength: 1024 },
        },
      );
      assert.equal(ticket.status, 403);

      const registered = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/photos`,
        {
          token: intruder.token,
          body: {
            objectKey: `stores/${owner.storeId}/${randomUUID()}.jpg`,
            contentType: "image/jpeg",
            byteSize: 1024,
          },
        },
      );
      assert.equal(registered.status, 403);

      assert.deepEqual(
        (await listMyStores(owner.token)).flatMap((store) => store.photos),
        [],
      );
    },
  );

  await t.test("a disallowed content type is rejected", async () => {
    for (const contentType of ["image/gif", "application/pdf", "image/jpeg "]) {
      const response = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/photo-uploads`,
        { token: owner.token, body: { contentType, contentLength: 1024 } },
      );
      assert.equal(response.status, 400);
    }

    assert.deepEqual(
      (await listMyStores(owner.token)).flatMap((store) => store.photos),
      [],
    );
  });

  await t.test("an image over the size limit is rejected", async () => {
    for (const contentLength of [0, -1, MAX_IMAGE_BYTES + 1]) {
      const response = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/photo-uploads`,
        {
          token: owner.token,
          body: { contentType: "image/jpeg", contentLength },
        },
      );
      assert.equal(response.status, 400);
    }
  });

  await t.test("the object key is never client chosen", async () => {
    const response = await call(
      "POST",
      `/api/v1/tenderos/stores/${owner.storeId}/photo-uploads`,
      {
        token: owner.token,
        body: {
          contentType: "image/jpeg",
          contentLength: 1024,
          objectKey: `stores/${intruder.storeId}/stolen.jpg`,
        },
      },
    );
    assert.equal(response.status, 400);
  });

  await t.test(
    "a presign returns an upload URL under the store's own prefix",
    async () => {
      const response = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/photo-uploads`,
        {
          token: owner.token,
          body: { contentType: "image/webp", contentLength: 2048 },
        },
      );
      assert.equal(response.status, 201);
      const ticket = ((await response.json()) as { data: ImageUploadTicket })
        .data;

      assert.ok(ticket.objectKey.startsWith(`stores/${owner.storeId}/`));
      assert.ok(ticket.objectKey.endsWith(".webp"));
      assert.equal(ticket.contentType, "image/webp");
      assert.equal(ticket.contentLength, 2048);
      assert.ok(ticket.expiresInSeconds > 0);

      const uploadUrl = new URL(ticket.uploadUrl);
      assert.equal(uploadUrl.pathname, `/savanhi-dev/${ticket.objectKey}`);
      assert.ok(uploadUrl.searchParams.get("X-Amz-Signature"));
      assert.match(
        uploadUrl.searchParams.get("X-Amz-SignedHeaders") ?? "",
        /content-length/,
      );

      // A second ticket never reuses a key.
      const again = await call(
        "POST",
        `/api/v1/tenderos/stores/${owner.storeId}/photo-uploads`,
        {
          token: owner.token,
          body: { contentType: "image/webp", contentLength: 2048 },
        },
      );
      const other = ((await again.json()) as { data: ImageUploadTicket }).data;
      assert.notEqual(other.objectKey, ticket.objectKey);
    },
  );

  await t.test(
    "an object key outside the store's prefix cannot be registered",
    async () => {
      for (const objectKey of [
        `stores/${intruder.storeId}/${randomUUID()}.jpg`,
        `coupons/${owner.storeId}/${randomUUID()}.jpg`,
        `stores/${owner.storeId}/../${intruder.storeId}/x.jpg`,
      ]) {
        const response = await call(
          "POST",
          `/api/v1/tenderos/stores/${owner.storeId}/photos`,
          {
            token: owner.token,
            body: { objectKey, contentType: "image/jpeg", byteSize: 1024 },
          },
        );
        assert.equal(response.status, 403);
      }
    },
  );

  await t.test("registering a photo persists it and stores/me returns it", async () => {
    const ticketResponse = await call(
      "POST",
      `/api/v1/tenderos/stores/${owner.storeId}/photo-uploads`,
      {
        token: owner.token,
        body: { contentType: "image/png", contentLength: 4096 },
      },
    );
    const ticket = ((await ticketResponse.json()) as {
      data: ImageUploadTicket;
    }).data;

    const registered = await call(
      "POST",
      `/api/v1/tenderos/stores/${owner.storeId}/photos`,
      {
        token: owner.token,
        body: {
          objectKey: ticket.objectKey,
          contentType: "image/png",
          byteSize: 4096,
        },
      },
    );
    assert.equal(registered.status, 201);
    const photo = ((await registered.json()) as { data: StorePhoto }).data;
    assert.equal(photo.contentType, "image/png");
    assert.equal(photo.position, 0);
    assert.ok(photo.url.includes(ticket.objectKey));
    // S11: a store photo carries no timestamp for the UI to render.
    assert.deepEqual(Object.keys(photo).sort(), [
      "contentType",
      "id",
      "position",
      "url",
    ]);

    const ownerStores = await listMyStores(owner.token);
    const ownerStore = ownerStores.find((store) => store.id === owner.storeId);
    assert.ok(ownerStore);
    assert.equal(ownerStore.photos.length, 1);
    assert.equal(ownerStore.photos[0]?.id, photo.id);
    assert.ok(ownerStore.photos[0]?.url.includes(ticket.objectKey));

    // The same object reference cannot be registered twice.
    const duplicate = await call(
      "POST",
      `/api/v1/tenderos/stores/${owner.storeId}/photos`,
      {
        token: owner.token,
        body: {
          objectKey: ticket.objectKey,
          contentType: "image/png",
          byteSize: 4096,
        },
      },
    );
    assert.equal(duplicate.status, 409);
    assert.equal((await listMyStores(owner.token))[0]?.photos.length, 1);
  });

  await t.test(
    "PRESERVE: stores/me answers with an empty photo list for a store without photos",
    async () => {
      const intruderStores = await listMyStores(intruder.token);
      assert.equal(intruderStores.length, 1);
      assert.deepEqual(intruderStores[0]?.photos, []);
      // The pre-existing store fields are untouched.
      assert.equal(intruderStores[0]?.id, intruder.storeId);
      assert.equal(intruderStores[0]?.name, "Tienda intruder");
      assert.equal(intruderStores[0]?.active, true);
      // `photos` is the ONLY key this task adds to the stores/me payload.
      assert.deepEqual(Object.keys(intruderStores[0] ?? {}).sort(), [
        "active",
        "address",
        "bankAccountName",
        "bankAccountNumber",
        "bankAccountType",
        "createdAt",
        "id",
        "latitude",
        "longitude",
        "name",
        "ownerProfileId",
        "paymentMethod",
        "photos",
      ]);
    },
  );
});
