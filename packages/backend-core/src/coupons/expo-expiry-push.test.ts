import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExpiryReminder } from "./expiry-reminder-policy.js";
import { createExpoExpiryPush, EXPO_PUSH_URL } from "./expo-expiry-push.js";

const input = {
  to: "ExponentPushToken[test-token]",
  message: buildExpiryReminder("claim-1"),
  expiresAtEpoch: 1_800_000_000,
};
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function transport(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, timeoutMs = 1000) {
  const calls: { url: string; init: RequestInit }[] = [];
  const push = createExpoExpiryPush({
    timeoutMs,
    fetch: (url, init) => {
      calls.push({ url: String(url), init: init! });
      return fetchImpl(String(url), init!);
    },
  });
  return { push, calls };
}

test("posts one message to the fixed Expo endpoint with only the generic payload", async () => {
  const { push, calls } = transport(() => reply({ data: { status: "ok", id: "ticket" } }));
  assert.equal(await push.send(input), "accepted");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://exp.host/--/api/v2/push/send");
  assert.equal(EXPO_PUSH_URL, calls[0]!.url);
  assert.equal(calls[0]!.init.method, "POST");
  assert.ok(calls[0]!.init.signal, "every request is time limited");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    to: input.to,
    title: "Tu cupón vence mañana",
    body: "Abre Savanhi para ver dónde canjearlo.",
    data: { type: "coupon-expiry-reminder", claimId: "claim-1" },
    expiration: 1_800_000_000,
    priority: "high",
  });
});

test("maps the provider answer without reading delivery into a ticket", async () => {
  const cases: [Promise<Response>, string][] = [
    [reply({ data: { status: "error", details: { error: "DeviceNotRegistered" } } }), "device_not_registered"],
    [reply({ data: { status: "error", details: { error: "MessageTooBig" } } }), "rejected"],
    [reply({ errors: [{ code: "VALIDATION_ERROR" }] }, 400), "rejected"],
    [reply({}, 503), "unknown"],
    [reply({ data: "unexpected" }), "unknown"],
    [Promise.resolve(new Response("<html>", { status: 200 })), "unknown"],
    [Promise.reject(new Error("socket hang up")), "unknown"],
  ];
  for (const [answer, expected] of cases) {
    assert.equal(await transport(() => answer).push.send(input), expected);
  }
});

test("a request that never answers is aborted and reported as unknown, once", async () => {
  const { push, calls } = transport(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) =>
        init.signal!.addEventListener("abort", () => reject(new Error("aborted"))),
      ),
    20,
  );
  assert.equal(await push.send(input), "unknown");
  assert.equal(calls.length, 1);
});
