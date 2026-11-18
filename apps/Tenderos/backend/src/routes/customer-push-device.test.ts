import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import test from "node:test";
import type { OtpRequestResponse, OtpVerifyResponse } from "@repo/api-contracts";
import {
  createAuthRouter,
  createBackendApp,
  createBackendContext,
  createObjectStorage,
  type BackendEnv,
} from "@repo/backend-core";
import { createApiRouter } from "./index.js";

const databaseUrl = process.env.PUSH_TEST_DATABASE_URL;

test("only eligible customer sessions can register and remove their push device", {
  skip: !databaseUrl && "Set PUSH_TEST_DATABASE_URL to a disposable, migrated local database",
}, async (t) => {
  assert.equal(new URL(databaseUrl!).hostname, "127.0.0.1");
  const env: BackendEnv = {
    serviceName: "customer-push-device-test",
    nodeEnv: "test",
    databaseUrl: databaseUrl!,
    port: 1,
    allowedOrigins: [],
    authJwtSecret: randomUUID(),
    authJwtIssuer: "customer-push-device-test",
    authJwtAudience: "savanhi-api",
    trustProxy: false,
    otpProvider: "development",
    otpDevCode: "123456",
    rateLimits: { api: 1000, otpRequest: 1000, otpVerify: 1000, refresh: 1000 },
  };
  const context = createBackendContext(env);
  const { authRouter, requireRole } = createAuthRouter(context.authService);
  const storage = createObjectStorage({
    endpoint: "http://127.0.0.1:1",
    region: "local",
    bucket: "unused",
    accessKeyId: "unused",
    secretAccessKey: "unused",
    uploadUrlTtlSeconds: 60,
    readUrlTtlSeconds: 60,
  });
  const server = createBackendApp({
    env,
    routers: [authRouter, createApiRouter({ context, requireRole, storage })],
  }).listen(0, "127.0.0.1");
  const emails: string[] = [];
  t.after(async () => {
    server.close();
    await storage.destroy();
    await context.db.pool.query("delete from users where email = any($1::text[])", [emails]);
    await context.db.pool.end();
  });
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (method: string, path: string, token?: string, body?: object) =>
    fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    });

  async function signIn(registrationRole: "client" | "tendero", adult = true) {
    const email = `${randomUUID()}@example.test`;
    emails.push(email);
    const request = await call("POST", "/auth/otp/request", undefined, { email });
    assert.equal(request.status, 200);
    const { challengeId } = await request.json() as OtpRequestResponse;
    const verify = await call("POST", "/auth/otp/verify", undefined, {
      email, challengeId, token: "123456", registrationRole,
    });
    assert.equal(verify.status, 200, await verify.clone().text());
    const { user, session } = await verify.json() as OtpVerifyResponse;
    if (registrationRole === "client" && adult) {
      const profile = await call("PUT", "/api/v1/clientes/profile", session.accessToken, {
        fullName: "Push Test", birthDate: "1990-01-01",
      });
      assert.equal(profile.status, 200, await profile.clone().text());
    }
    return { user, ...session };
  }

  const route = "/api/v1/clientes/push-device";
  const device = { expoToken: `ExpoPushToken[${randomUUID()}]` };
  const adult = await signIn("client");
  const other = await signIn("client");
  const gated = await signIn("client", false);
  const tendero = await signIn("tendero");
  assert.equal((await call("PUT", route, undefined, device)).status, 401);
  assert.equal((await call("PUT", route, gated.accessToken, device)).status, 403);
  assert.equal((await call("PUT", route, tendero.accessToken, device)).status, 403);
  assert.equal((await call("PUT", route, adult.accessToken, { expoToken: "invalid" })).status, 400);
  assert.equal((await call("PUT", route, adult.accessToken, device)).status, 204);
  assert.equal((await call("PUT", route, adult.accessToken, device)).status, 204);

  const owner = () => context.db.pool.query<{ user_id: string }>(
    "select user_id from customer_push_devices where expo_token = $1", [device.expoToken],
  ).then((result) => result.rows.map((row) => row.user_id));
  assert.deepEqual(await owner(), [adult.user.id]);
  assert.equal((await call("DELETE", route, other.accessToken)).status, 204);
  assert.deepEqual(await owner(), [adult.user.id]);
  const rotate = async (refreshToken: string) => {
    const refresh = await call("POST", "/auth/refresh", undefined, { refreshToken });
    assert.equal(refresh.status, 200, await refresh.clone().text());
    return (await refresh.json() as { session: { accessToken: string; refreshToken: string } }).session;
  };
  const tokenOwner = (expoToken: string) => context.db.pool.query<{ user_id: string }>(
    "select user_id from customer_push_devices where expo_token = $1", [expoToken],
  ).then((result) => result.rows.map((row) => row.user_id));

  // Refresh keeps the registration: it is bound to the refresh-token family.
  const refreshed = await rotate(adult.refreshToken!);
  assert.deepEqual(await owner(), [adult.user.id]);
  assert.equal((await call("PUT", route, adult.accessToken, device)).status, 401);
  assert.equal((await call("DELETE", route, refreshed.accessToken)).status, 204);
  assert.deepEqual(await owner(), []);
  assert.equal((await call("DELETE", route, refreshed.accessToken)).status, 204);

  // Account switch on one device: the token moves to the newest session only.
  assert.equal((await call("PUT", route, refreshed.accessToken, device)).status, 204);
  assert.equal((await call("PUT", route, other.accessToken, device)).status, 204);
  assert.deepEqual(await owner(), [other.user.id]);
  assert.equal((await call("DELETE", route, refreshed.accessToken)).status, 204);
  assert.deepEqual(await owner(), [other.user.id]);

  // One token per session family: a new token replaces the previous one.
  const next = { expoToken: `ExpoPushToken[${randomUUID()}]` };
  assert.equal((await call("PUT", route, other.accessToken, next)).status, 204);
  assert.deepEqual(await owner(), []);
  assert.deepEqual(await tokenOwner(next.expoToken), [other.user.id]);

  // Losing eligibility blocks registering but never removing.
  await context.db.pool.query("update users set birth_date = null where id = $1", [other.user.id]);
  assert.equal((await call("PUT", route, other.accessToken, device)).status, 403);
  assert.deepEqual(await tokenOwner(next.expoToken), [other.user.id]);
  assert.equal((await call("DELETE", route, other.accessToken)).status, 204);
  assert.deepEqual(await tokenOwner(next.expoToken), []);

  // Server sign-out revokes the family and drops its device.
  const session = await rotate(refreshed.refreshToken);
  assert.equal((await call("PUT", route, session.accessToken, device)).status, 204);
  assert.deepEqual(await owner(), [adult.user.id]);
  assert.equal((await call("POST", "/auth/logout", session.accessToken)).status, 200);
  assert.deepEqual(await owner(), []);
  assert.equal((await call("PUT", route, session.accessToken, device)).status, 401);
  assert.deepEqual(await owner(), []);

  const client = async () => signIn("client");
  const rowsOf = (userIds: string[]) => context.db.pool.query<{ user_id: string; expo_token: string }>(
    "select user_id, expo_token from customer_push_devices where user_id = any($1::uuid[]) order by expo_token", [userIds],
  ).then((result) => result.rows);
  const newToken = () => ({ expoToken: `ExpoPushToken[${randomUUID()}]` });

  await t.test("rejected writes from rotated or revoked sessions change nothing", async () => {
    const [a, b, c] = [await client(), await client(), await client()];
    const [da, db] = [newToken(), newToken()];
    assert.equal((await call("PUT", route, a.accessToken, da)).status, 204);
    assert.equal((await call("PUT", route, b.accessToken, db)).status, 204);
    const ids = [a.user.id, b.user.id, c.user.id];
    const before = await rowsOf(ids);
    const live = await rotate(a.refreshToken!);
    for (const body of [da, db, newToken()]) {
      assert.equal((await call("PUT", route, a.accessToken, body)).status, 401);
    }
    assert.equal((await call("DELETE", route, a.accessToken)).status, 401);
    assert.equal((await call("POST", "/auth/logout", a.accessToken)).status, 401);
    assert.equal((await call("POST", "/auth/logout", c.accessToken)).status, 200);
    assert.equal((await call("PUT", route, c.accessToken, db)).status, 401);
    assert.deepEqual(await rowsOf(ids), before);
    // The rotated family was not revoked by the stale logout and still registers.
    assert.equal((await call("PUT", route, live.accessToken, da)).status, 204);
    assert.deepEqual(await rowsOf(ids), before);
  });

  await t.test("concurrent registrations keep one owner per token and one token per family", async () => {
    const racers = await Promise.all(Array.from({ length: 8 }, client));
    const hot = newToken();
    const results = await Promise.all(racers.map((racer) => call("PUT", route, racer.accessToken, hot)));
    assert.deepEqual(results.map((response) => response.status), Array(8).fill(204));
    assert.equal((await tokenOwner(hot.expoToken)).length, 1);

    const single = await client();
    const tokens = Array.from({ length: 8 }, newToken);
    const writes = await Promise.all(tokens.map((body) => call("PUT", route, single.accessToken, body)));
    assert.deepEqual(writes.map((response) => response.status), Array(8).fill(204));
    assert.equal((await rowsOf([single.user.id])).length, 1);
  });

  await t.test("a registration racing sign-out never survives the acknowledged logout", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const racer = await client();
      const [put, logout] = await Promise.all([
        call("PUT", route, racer.accessToken, newToken()),
        call("POST", "/auth/logout", racer.accessToken),
      ]);
      assert.equal(logout.status, 200);
      assert.ok([204, 401].includes(put.status), `PUT answered ${put.status}`);
      assert.deepEqual(await rowsOf([racer.user.id]), []);
    }
  });

  await t.test("refresh reuse revokes the family and leaves a device row the sender must skip", async () => {
    const victim = await client();
    const body = newToken();
    assert.equal((await call("PUT", route, victim.accessToken, body)).status, 204);
    const rotated = await rotate(victim.refreshToken!);
    const reuse = await call("POST", "/auth/refresh", undefined, { refreshToken: victim.refreshToken });
    assert.equal(reuse.status, 401);
    assert.equal((await call("PUT", route, rotated.accessToken, body)).status, 401);
    const { rows } = await context.db.pool.query<{ devices: number; live: number }>(
      `select count(*)::int as devices,
              (select count(*)::int from auth_sessions s
                where s.family_id = d.family_id and s.revoked_at is null
                  and s.rotated_at is null and s.expires_at > now()) as live
         from customer_push_devices d where d.user_id = $1 group by d.family_id`, [victim.user.id],
    );
    assert.deepEqual(rows, [{ devices: 1, live: 0 }]);
  });
});
