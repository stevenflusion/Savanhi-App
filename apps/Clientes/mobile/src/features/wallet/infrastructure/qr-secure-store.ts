import * as SecureStore from "expo-secure-store";

import type {
  QrOwner,
  QrReadResult,
  QrTokenStore,
  QrWriteResult,
} from "../application/ports";
import { isQrToken } from "../domain/claim";

/** SecureStore keys allow only alphanumerics, `.`, `-` and `_`. */
const KEY_PART = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Its own keys, one per user and claim, holding the raw token and nothing else.
 * The user id scopes the entry; it is never proof of authorization, so every
 * operation also asks its owner whether it is still current.
 */
function keyFor(userId: string, claimId: string): string | null {
  if (!KEY_PART.test(userId) || !KEY_PART.test(claimId)) return null;
  return `savanhi-clientes-qr.${userId}.${claimId}`;
}

// ONE queue for the whole runtime, shared by every provider and every store
// instance. A new provider can therefore never run its keystore work beside an
// older provider's pending operation: the older one finishes (and cleans up)
// first. It is deliberately separate from the auth session queue.
let queue: Promise<void> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function read(owner: QrOwner, claimId: string): Promise<QrReadResult> {
  if (!owner.isCurrent()) return { status: "stale" };
  const key = keyFor(owner.userId, claimId);
  if (!key) return { status: "missing" };

  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(key);
  } catch {
    return { status: "error" };
  }
  if (!owner.isCurrent()) return { status: "stale" };
  if (raw === null) return { status: "missing" };
  if (!isQrToken(raw)) {
    // Not something this app wrote: drop it rather than ever showing it.
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
    return { status: "missing" };
  }
  return { status: "ok", token: raw };
}

async function write(
  owner: QrOwner,
  claimId: string,
  token: string,
): Promise<QrWriteResult> {
  if (!owner.isCurrent()) return "stale";
  const key = keyFor(owner.userId, claimId);
  if (!key || !isQrToken(token)) return "failed";

  try {
    await SecureStore.setItemAsync(key, token);
  } catch {
    return "failed";
  }
  if (owner.isCurrent()) return "saved";

  // The owner ended while the keystore was busy. Remove only what THIS
  // operation wrote, inside the same queue turn: a newer token for the same
  // key can never be deleted by this older operation.
  try {
    const current = await SecureStore.getItemAsync(key);
    if (current === token) await SecureStore.deleteItemAsync(key);
  } catch {
    return "failed";
  }
  return "stale";
}

async function remove(owner: QrOwner, claimId: string): Promise<void> {
  if (!owner.isCurrent()) return;
  const key = keyFor(owner.userId, claimId);
  if (!key) return;
  await SecureStore.deleteItemAsync(key).catch(() => undefined);
}

/** A thin wrapper: all instances share the module-held queue above. */
export function createQrTokenStore(): QrTokenStore {
  return {
    read: (owner, claimId) => enqueue(() => read(owner, claimId)),
    write: (owner, claimId, token) =>
      enqueue(() => write(owner, claimId, token)),
    remove: (owner, claimId) => enqueue(() => remove(owner, claimId)),
  };
}
