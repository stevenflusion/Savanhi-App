import * as SecureStore from "expo-secure-store";

import type { QrOwner } from "@/src/features/wallet/application/ports";
import { createQrTokenStore } from "@/src/features/wallet/infrastructure/qr-secure-store";

const backing = (SecureStore as unknown as { __store: Map<string, string> })
  .__store;
const setItem = SecureStore.setItemAsync as jest.Mock;
const getItem = SecureStore.getItemAsync as jest.Mock;
const deleteItem = SecureStore.deleteItemAsync as jest.Mock;

const TOKEN_A = "aB3-_xY9kLmN0pQrStUvWxYz1234567890AbCdEfGhI";
const TOKEN_B = "Zz9_-yX8wVuT7sRqP6oNmL5kJiH4gFeD3cBa2A1b0Cd";
const CLAIM = "d1111111-1111-4111-8111-111111111111";
const KEY = `savanhi-clientes-qr.user-1.${CLAIM}`;

function owner(userId = "user-1") {
  const state = { alive: true };
  const value: QrOwner & { end: () => void } = {
    userId,
    isCurrent: () => state.alive,
    end: () => {
      state.alive = false;
    },
  };
  return value;
}
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setImmediate(r));

const logSpies = ["log", "info", "warn", "error", "debug"].map((m) =>
  jest.spyOn(console, m as "log").mockImplementation(() => {}),
);

beforeEach(() => {
  backing.clear();
  setItem.mockClear();
  getItem.mockClear();
  deleteItem.mockClear();
  logSpies.forEach((s) => s.mockClear());
});

describe("QR token store", () => {
  it("round-trips the raw token under its own user and claim key, and nothing else", async () => {
    const store = createQrTokenStore();
    const o = owner();
    expect(await store.write(o, CLAIM, TOKEN_A)).toBe("saved");
    expect([...backing.entries()]).toEqual([[KEY, TOKEN_A]]);
    expect(await store.read(o, CLAIM)).toEqual({ status: "ok", token: TOKEN_A });
  });

  it("answers missing for an unknown claim and for another user's key", async () => {
    const store = createQrTokenStore();
    await store.write(owner(), CLAIM, TOKEN_A);
    expect(await store.read(owner("user-2"), CLAIM)).toEqual({
      status: "missing",
    });
    expect(await store.read(owner(), "d2222222-2222-4222-8222-222222222222")).toEqual(
      { status: "missing" },
    );
  });

  it("does not touch the keystore for an owner that is already gone", async () => {
    const store = createQrTokenStore();
    const o = owner();
    o.end();
    expect(await store.write(o, CLAIM, TOKEN_A)).toBe("stale");
    expect(await store.read(o, CLAIM)).toEqual({ status: "stale" });
    await store.remove(o, CLAIM);
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(deleteItem).not.toHaveBeenCalled();
    expect(backing.size).toBe(0);
  });

  it("removes a stored token for a live owner and leaves it for a gone one", async () => {
    const store = createQrTokenStore();
    const live = owner();
    await store.write(live, CLAIM, TOKEN_A);
    const gone = owner();
    gone.end();
    await store.remove(gone, CLAIM);
    expect(backing.get(KEY)).toBe(TOKEN_A);
    await store.remove(live, CLAIM);
    expect(backing.has(KEY)).toBe(false);
  });

  it("a write whose owner ends while the keystore is busy cleans up its own value", async () => {
    const store = createQrTokenStore();
    const o = owner();
    const gate = deferred();
    setItem.mockImplementationOnce(async (key: string, value: string) => {
      await gate.promise;
      backing.set(key, value);
    });
    const result = store.write(o, CLAIM, TOKEN_A);
    await flush();
    o.end();
    gate.resolve();
    expect(await result).toBe("stale");
    expect(backing.has(KEY)).toBe(false);
  });

  it("an old write finishing late cannot delete a newer token it does not own", async () => {
    const store = createQrTokenStore();
    const oldOwner = owner();
    const gate = deferred();
    setItem.mockImplementationOnce(async (key: string, value: string) => {
      await gate.promise;
      backing.set(key, value);
    });
    const oldWrite = store.write(oldOwner, CLAIM, TOKEN_A);
    await flush();
    oldOwner.end();
    // Something else stored a newer token for the same key right before the
    // cleanup looks at it: the old operation must leave that value alone.
    getItem.mockImplementationOnce(async (key: string) => {
      backing.set(key, TOKEN_B);
      return TOKEN_B;
    });
    gate.resolve();
    expect(await oldWrite).toBe("stale");
    expect(backing.get(KEY)).toBe(TOKEN_B);
    expect(deleteItem).not.toHaveBeenCalled();
  });

  it("the queue is shared: a second store instance waits for the first one's pending write", async () => {
    const first = createQrTokenStore();
    const second = createQrTokenStore();
    const gate = deferred();
    setItem.mockImplementationOnce(async (key: string, value: string) => {
      await gate.promise;
      backing.set(key, value);
    });
    const oldOwner = owner();
    const write = first.write(oldOwner, CLAIM, TOKEN_A);
    await flush();
    const newOwner = owner();
    const newWrite = second.write(newOwner, CLAIM, TOKEN_B);
    await flush();
    // The newer instance has not touched the keystore while the old op is open.
    expect(setItem).toHaveBeenCalledTimes(1);
    oldOwner.end();
    gate.resolve();
    expect(await write).toBe("stale");
    expect(await newWrite).toBe("saved");
    // Old value cleaned up first, the newer token is what remains.
    expect(backing.get(KEY)).toBe(TOKEN_B);
    expect(setItem.mock.calls.map((c) => c[1])).toEqual([TOKEN_A, TOKEN_B]);
  });

  it("reports a failed write without leaking the token", async () => {
    const store = createQrTokenStore();
    setItem.mockRejectedValueOnce(new Error(`keystore refused ${TOKEN_A}`));
    expect(await store.write(owner(), CLAIM, TOKEN_A)).toBe("failed");
    expect(JSON.stringify(logSpies.map((s) => s.mock.calls))).not.toContain(
      TOKEN_A,
    );
  });

  it("reports a failed cleanup as failed, never as saved", async () => {
    const store = createQrTokenStore();
    const o = owner();
    const gate = deferred();
    setItem.mockImplementationOnce(async (key: string, value: string) => {
      await gate.promise;
      backing.set(key, value);
    });
    deleteItem.mockRejectedValueOnce(new Error("cannot delete"));
    const result = store.write(o, CLAIM, TOKEN_A);
    await flush();
    o.end();
    gate.resolve();
    expect(await result).toBe("failed");
  });

  it("reports a keystore read failure as an error, not as a missing token", async () => {
    const store = createQrTokenStore();
    getItem.mockRejectedValueOnce(new Error("keystore locked"));
    expect(await store.read(owner(), CLAIM)).toEqual({ status: "error" });
  });

  it("treats a stored value that is not a token as missing and drops it", async () => {
    const store = createQrTokenStore();
    backing.set(KEY, "not a token!");
    expect(await store.read(owner(), CLAIM)).toEqual({ status: "missing" });
    expect(backing.has(KEY)).toBe(false);
  });

  it.each([
    ["a claim id with a slash", "a/b", TOKEN_A],
    ["a claim id that is empty", "", TOKEN_A],
    ["a token that is a URL", CLAIM, "https://x.example/qr?t=abcdefghijklmnop"],
  ])("refuses to store %s", async (_label, claimId, token) => {
    const store = createQrTokenStore();
    expect(await store.write(owner(), claimId, token)).toBe("failed");
    expect(setItem).not.toHaveBeenCalled();
    expect(backing.size).toBe(0);
  });

  it("refuses an unsafe user id", async () => {
    const store = createQrTokenStore();
    expect(await store.write(owner("u/../x"), CLAIM, TOKEN_A)).toBe("failed");
    expect(backing.size).toBe(0);
  });
});
