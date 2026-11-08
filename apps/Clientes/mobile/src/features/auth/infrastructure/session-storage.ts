import * as SecureStore from "expo-secure-store";

import type { AuthSessionRepository } from "../application/ports";
import type { StoredAuthSession } from "../domain/auth.types";

/** Its own key: never shared with the Tenderos session. */
export const CLIENT_SESSION_STORAGE_KEY = "savanhi-clientes-session";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeStoredAuthSession(
  value: unknown,
): StoredAuthSession | null {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.session)) {
    return null;
  }
  const { user, session } = value;
  if (typeof user.id !== "string" || typeof user.role !== "string") {
    return null;
  }
  if (typeof session.accessToken !== "string" || !session.accessToken) {
    return null;
  }

  return {
    user: user as unknown as StoredAuthSession["user"],
    session: {
      accessToken: session.accessToken,
      refreshToken:
        typeof session.refreshToken === "string" ? session.refreshToken : null,
      expiresAt: typeof session.expiresAt === "number" ? session.expiresAt : null,
    },
  };
}

async function persistAuthSession(value: StoredAuthSession | null) {
  if (value) {
    await SecureStore.setItemAsync(
      CLIENT_SESSION_STORAGE_KEY,
      JSON.stringify(value),
    );
    return;
  }

  await SecureStore.deleteItemAsync(CLIENT_SESSION_STORAGE_KEY);
}

async function loadAuthSession(): Promise<StoredAuthSession | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(CLIENT_SESSION_STORAGE_KEY);
  } catch {
    // An unreadable keystore means signed out; it must not crash the app.
    return null;
  }
  if (!raw) return null;

  let stored: StoredAuthSession | null = null;
  try {
    stored = normalizeStoredAuthSession(JSON.parse(raw));
  } catch {
    stored = null;
  }
  if (!stored) {
    await SecureStore.deleteItemAsync(CLIENT_SESSION_STORAGE_KEY).catch(
      () => undefined,
    );
  }
  return stored;
}

export function createSecureStoreAuthSessionRepository(): AuthSessionRepository {
  let operationQueue: Promise<unknown> = Promise.resolve();

  // Every keystore operation runs in call order, so a late write can never
  // overtake a later sign-out.
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function isCurrentGeneration(
    current: StoredAuthSession | null,
    expected: StoredAuthSession,
  ) {
    return (
      current?.user.id === expected.user.id &&
      current.session.accessToken === expected.session.accessToken &&
      current.session.refreshToken === expected.session.refreshToken
    );
  }

  return {
    load: () => enqueue(loadAuthSession),
    save: (value) => enqueue(() => persistAuthSession(value)),
    saveIfCurrent: (expected, value) =>
      enqueue(async () => {
        const current = await loadAuthSession();
        if (!isCurrentGeneration(current, expected)) return false;
        await persistAuthSession(value);
        return true;
      }),
  };
}
