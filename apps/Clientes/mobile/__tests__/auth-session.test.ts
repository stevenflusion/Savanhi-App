import type { AuthUser } from "@repo/api-contracts";
import * as SecureStore from "expo-secure-store";

import { executeProtectedAuthRequest } from "@/src/features/auth/application/execute-protected-auth-request";
import type {
  AuthRemoteRepository,
  AuthRemoteResult,
} from "@/src/features/auth/application/ports";
import { createAuthUseCases } from "@/src/features/auth/application/use-cases";
import type { StoredAuthSession } from "@/src/features/auth/domain/auth.types";
import {
  CLIENT_SESSION_STORAGE_KEY,
  createSecureStoreAuthSessionRepository,
} from "@/src/features/auth/infrastructure/session-storage";

const backing = (SecureStore as unknown as { __store: Map<string, string> })
  .__store;

const user = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: "user-1",
  email: "cliente@example.test",
  fullName: "Camila Vega",
  role: "client",
  active: true,
  emailVerifiedAt: "2026-11-08T00:00:00.000Z",
  registrationStatus: "completed",
  ...overrides,
});

// One fixed instant, so two calls to `stored()` build equal objects.
const FAR_FUTURE = Date.UTC(2100, 0, 1);

const stored = (
  access = "access-1",
  refresh: string | null = "refresh-1",
  expiresAt: number | null = FAR_FUTURE,
): StoredAuthSession => ({
  user: user(),
  session: { accessToken: access, refreshToken: refresh, expiresAt },
});

function memorySessionRepository(initial: StoredAuthSession | null) {
  let current = initial;
  return {
    load: jest.fn(async () => current),
    save: jest.fn(async (value: StoredAuthSession | null) => {
      current = value;
    }),
    saveIfCurrent: jest.fn(
      async (expected: StoredAuthSession, value: StoredAuthSession | null) => {
        if (
          current?.user.id !== expected.user.id ||
          current.session.accessToken !== expected.session.accessToken ||
          current.session.refreshToken !== expected.session.refreshToken
        ) {
          return false;
        }
        current = value;
        return true;
      },
    ),
  };
}

function remote(
  overrides: Partial<AuthRemoteRepository> = {},
): jest.Mocked<AuthRemoteRepository> {
  return {
    refreshSession: jest.fn(),
    getCurrentUser: jest.fn(),
    requestOtp: jest.fn(),
    verifyOtp: jest.fn(),
    getProfile: jest.fn(),
    saveProfile: jest.fn(),
    logout: jest.fn(async () => undefined),
    ...overrides,
  } as jest.Mocked<AuthRemoteRepository>;
}

const ok = <T>(data: T): AuthRemoteResult<T> => ({ success: true, data });
const unauthorized = (): AuthRemoteResult<never> => ({
  success: false,
  error: "x",
  status: 401,
  unauthorized: true,
});
const rotated = {
  accessToken: "access-2",
  refreshToken: "refresh-2",
  expiresIn: 900,
};

beforeEach(() => {
  backing.clear();
  jest.clearAllMocks();
});

describe("protected requests (T2c, refresh serialization)", () => {
  it("refreshes only after a 401, persists the rotation and retries once", async () => {
    const sessions = memorySessionRepository(stored());
    const remoteRepository = remote({
      refreshSession: jest.fn(async () => ({
        success: true as const,
        session: rotated,
      })),
    });
    const request = jest
      .fn<Promise<AuthRemoteResult<string>>, [string]>()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok("done"));

    const outcome = await executeProtectedAuthRequest({
      stored: stored(),
      remoteRepository,
      sessionRepository: sessions,
      request,
    });

    expect(request.mock.calls.map(([token]) => token)).toEqual([
      "access-1",
      "access-2",
    ]);
    expect(remoteRepository.refreshSession).toHaveBeenCalledTimes(1);
    expect(remoteRepository.refreshSession).toHaveBeenCalledWith("refresh-1");
    expect(outcome.result).toEqual({ success: true, data: "done" });
    expect(outcome.stored?.session.accessToken).toBe("access-2");
    expect((await sessions.load())?.session.refreshToken).toBe("refresh-2");
  });

  it("does not refresh or retry for a failure that is not a 401", async () => {
    const remoteRepository = remote();
    const request = jest.fn(
      async (): Promise<AuthRemoteResult<string>> => ({
        success: false,
        error: "x",
        status: 500,
        unauthorized: false,
      }),
    );

    const outcome = await executeProtectedAuthRequest({
      stored: stored(),
      remoteRepository,
      sessionRepository: memorySessionRepository(stored()),
      request,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(remoteRepository.refreshSession).not.toHaveBeenCalled();
    expect(outcome.result.success).toBe(false);
  });

  it("stops after a 401 from the only retry instead of looping", async () => {
    const remoteRepository = remote({
      refreshSession: jest.fn(async () => ({
        success: true as const,
        session: rotated,
      })),
    });
    const request = jest.fn(async () => unauthorized());

    await executeProtectedAuthRequest({
      stored: stored(),
      remoteRepository,
      sessionRepository: memorySessionRepository(stored()),
      request,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(remoteRepository.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("clears the session only for a terminal refresh rejection", async () => {
    const terminalSessions = memorySessionRepository(stored());
    await executeProtectedAuthRequest({
      stored: stored(),
      remoteRepository: remote({
        refreshSession: jest.fn(async () => ({
          success: false as const,
          error: "x",
          status: 401,
          terminal: true,
        })),
      }),
      sessionRepository: terminalSessions,
      request: jest.fn(async () => unauthorized()),
    });
    expect(await terminalSessions.load()).toBeNull();

    const transientSessions = memorySessionRepository(stored());
    const outcome = await executeProtectedAuthRequest({
      stored: stored(),
      remoteRepository: remote({
        refreshSession: jest.fn(async () => ({
          success: false as const,
          error: "x",
          terminal: false,
        })),
      }),
      sessionRepository: transientSessions,
      request: jest.fn(async () => unauthorized()),
    });
    expect(await transientSessions.load()).toEqual(stored());
    expect(outcome.stored).toEqual(stored());
  });

  it("does not rotate a session that was logged out while the refresh ran", async () => {
    const sessions = memorySessionRepository(stored());
    const remoteRepository = remote({
      refreshSession: jest.fn(async () => {
        await sessions.save(null);
        return { success: true as const, session: rotated };
      }),
    });

    const outcome = await executeProtectedAuthRequest({
      stored: stored(),
      remoteRepository,
      sessionRepository: sessions,
      request: jest.fn(async () => unauthorized()),
    });

    expect(await sessions.load()).toBeNull();
    expect(outcome.stored).toBeNull();
  });

  it("does not overwrite a different account that signed in during the refresh", async () => {
    const other: StoredAuthSession = {
      ...stored("other-access", "other-refresh"),
      user: user({ id: "user-2" }),
    };
    const sessions = memorySessionRepository(stored());
    const remoteRepository = remote({
      refreshSession: jest.fn(async () => {
        await sessions.save(other);
        return { success: true as const, session: rotated };
      }),
    });

    const outcome = await executeProtectedAuthRequest({
      stored: stored(),
      remoteRepository,
      sessionRepository: sessions,
      request: jest.fn(async () => unauthorized()),
    });

    expect(await sessions.load()).toEqual(other);
    expect(outcome.stored).toEqual(other);
  });
});

describe("customer session storage", () => {
  it("keeps the session under a customer-specific key", async () => {
    const repository = createSecureStoreAuthSessionRepository();
    await repository.save(stored());

    expect(CLIENT_SESSION_STORAGE_KEY).not.toBe("savanhi-mobile-session");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      CLIENT_SESSION_STORAGE_KEY,
      expect.any(String),
    );
    expect([...backing.keys()]).toEqual([CLIENT_SESSION_STORAGE_KEY]);
    expect(await repository.load()).toEqual(stored());
  });

  it("does not resurrect a logged-out session through saveIfCurrent", async () => {
    const repository = createSecureStoreAuthSessionRepository();
    const original = stored();
    await repository.save(original);
    await repository.save(null);

    const saved = await repository.saveIfCurrent(original, stored("access-2"));

    expect(saved).toBe(false);
    expect(backing.size).toBe(0);
  });

  it("does not overwrite a newer generation", async () => {
    const repository = createSecureStoreAuthSessionRepository();
    await repository.save(stored("access-1", "refresh-1"));
    await repository.save(stored("access-9", "refresh-9"));

    expect(
      await repository.saveIfCurrent(
        stored("access-1", "refresh-1"),
        stored("access-2", "refresh-2"),
      ),
    ).toBe(false);
    expect((await repository.load())?.session.accessToken).toBe("access-9");
  });

  it("serializes operations in call order", async () => {
    const repository = createSecureStoreAuthSessionRepository();
    await Promise.all([
      repository.save(stored("access-1", "refresh-1")),
      repository.save(null),
      repository.save(stored("access-3", "refresh-3")),
      repository.save(null),
    ]);

    expect(backing.size).toBe(0);
    expect(await repository.load()).toBeNull();
  });

  it("drops an unreadable stored value and starts signed out", async () => {
    backing.set(CLIENT_SESSION_STORAGE_KEY, "{not json");
    const repository = createSecureStoreAuthSessionRepository();

    expect(await repository.load()).toBeNull();
    expect(backing.has(CLIENT_SESSION_STORAGE_KEY)).toBe(false);
  });

  it("treats a keystore read failure as signed out instead of crashing", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(
      new Error("keystore unavailable"),
    );

    expect(await createSecureStoreAuthSessionRepository().load()).toBeNull();
  });
});

describe("auth use cases", () => {
  it("keeps a stored session when the refresh fails for a transient reason", async () => {
    const sessions = memorySessionRepository(stored("a", "r", Date.now() + 1000));
    const useCases = createAuthUseCases({
      remoteRepository: remote({
        refreshSession: jest.fn(async () => ({
          success: false as const,
          error: "x",
          terminal: false,
        })),
      }),
      sessionRepository: sessions,
    });

    expect(await useCases.initializeAuthSession()).toEqual(
      stored("a", "r", expect.any(Number) as unknown as number),
    );
    expect(await sessions.load()).not.toBeNull();
  });

  it("clears a stored session on a terminal refresh rejection", async () => {
    const sessions = memorySessionRepository(stored("a", "r", Date.now() + 1000));
    const useCases = createAuthUseCases({
      remoteRepository: remote({
        refreshSession: jest.fn(async () => ({
          success: false as const,
          error: "x",
          status: 401,
          terminal: true,
        })),
      }),
      sessionRepository: sessions,
    });

    expect(await useCases.initializeAuthSession()).toBeNull();
    expect(await sessions.load()).toBeNull();
  });

  it("restores a valid session and refreshes the stored user from the server", async () => {
    const sessions = memorySessionRepository(stored());
    const useCases = createAuthUseCases({
      remoteRepository: remote({
        getCurrentUser: jest.fn(async () =>
          ok(user({ fullName: "Camila Vega Ruiz" })),
        ),
      }),
      sessionRepository: sessions,
    });

    const restored = await useCases.initializeAuthSession();

    expect(restored?.user.fullName).toBe("Camila Vega Ruiz");
    expect((await sessions.load())?.user.fullName).toBe("Camila Vega Ruiz");
  });

  it("stores a verified session and sends the client role", async () => {
    const sessions = memorySessionRepository(null);
    const remoteRepository = remote({
      verifyOtp: jest.fn(async () => ({
        success: true as const,
        user: user({ registrationStatus: "profile_required", fullName: "" }),
        session: rotated,
      })),
    });
    const useCases = createAuthUseCases({
      remoteRepository,
      sessionRepository: sessions,
    });

    const result = await useCases.verifyAuthOtp("a@b.co", "challenge-1", "123456");

    expect(remoteRepository.verifyOtp).toHaveBeenCalledWith(
      "a@b.co",
      "challenge-1",
      "123456",
    );
    expect(result.success).toBe(true);
    expect((await sessions.load())?.session.accessToken).toBe("access-2");
  });

  it("does not store a verification that finished after the caller moved on", async () => {
    const sessions = memorySessionRepository(null);
    const useCases = createAuthUseCases({
      remoteRepository: remote({
        verifyOtp: jest.fn(async () => ({
          success: true as const,
          user: user(),
          session: rotated,
        })),
      }),
      sessionRepository: sessions,
    });

    const result = await useCases.verifyAuthOtp(
      "a@b.co",
      "challenge-1",
      "123456",
      () => false,
    );

    expect(result.success).toBe(false);
    expect(result.stored).toBeUndefined();
    expect(sessions.save).not.toHaveBeenCalled();
    expect(await sessions.load()).toBeNull();
  });

  it("undoes its own session when the caller moves on during the write", async () => {
    const sessions = memorySessionRepository(null);
    const useCases = createAuthUseCases({
      remoteRepository: remote({
        verifyOtp: jest.fn(async () => ({
          success: true as const,
          user: user({ id: "user-A" }),
          session: rotated,
        })),
      }),
      sessionRepository: sessions,
    });

    // Still current before the write, no longer current once it has finished
    // (a logout happened while the keystore was busy).
    const result = await useCases.verifyAuthOtp(
      "a@b.co",
      "c",
      "123456",
      () => sessions.save.mock.calls.length === 0,
    );

    expect(sessions.save).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.stored).toBeUndefined();
    expect(await sessions.load()).toBeNull();
  });

  it("discards a session only while it is still the stored generation", async () => {
    const sessions = memorySessionRepository(stored("access-1", "refresh-1"));
    const useCases = createAuthUseCases({
      remoteRepository: remote(),
      sessionRepository: sessions,
    });

    await sessions.save({ ...stored("b-access", "b-refresh"), user: user({ id: "user-B" }) });
    expect(await useCases.discardSession(stored("access-1", "refresh-1"))).toBe(false);
    expect((await sessions.load())?.user.id).toBe("user-B");

    expect(
      await useCases.discardSession({
        ...stored("b-access", "b-refresh"),
        user: user({ id: "user-B" }),
      }),
    ).toBe(true);
    expect(await sessions.load()).toBeNull();
  });

  it("clears the local session even when the server logout fails", async () => {
    const sessions = memorySessionRepository(stored());
    const remoteRepository = remote({
      logout: jest.fn(async () => {
        throw new Error("offline");
      }),
    });
    const useCases = createAuthUseCases({
      remoteRepository,
      sessionRepository: sessions,
    });

    await expect(useCases.logoutAuth(stored())).resolves.toBeUndefined();

    expect(await sessions.load()).toBeNull();
    expect(remoteRepository.logout).toHaveBeenCalledWith({
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });
  });

  it("does not call the server when there is no session to log out", async () => {
    const remoteRepository = remote();
    await createAuthUseCases({
      remoteRepository,
      sessionRepository: memorySessionRepository(null),
    }).logoutAuth(null);

    expect(remoteRepository.logout).not.toHaveBeenCalled();
  });
});
