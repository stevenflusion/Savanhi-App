import type { AuthUser } from "@repo/api-contracts";

import type { AuthRemoteRepository } from "@/src/features/auth/application/ports/auth-remote-repository";
import type { AuthSessionRepository } from "@/src/features/auth/application/ports/auth-session-repository";
import { executeProtectedAuthRequest } from "@/src/features/auth/application/use-cases/execute-protected-auth-request";
import { createCompleteAuthRegistrationUseCase } from "@/src/features/auth/application/use-cases/complete-auth-registration.use-case";
import { createInitializeAuthSessionUseCase } from "@/src/features/auth/application/use-cases/initialize-auth-session.use-case";
import { createUpdateAuthProfileUseCase } from "@/src/features/auth/application/use-cases/update-auth-profile.use-case";
import {
  createSynchronousLock,
  getOtpDeadline,
  normalizeOtpCode,
} from "@/src/features/auth/application/otp-flow";
import {
  getAuthLayoutRedirect,
  getCanonicalAuthPath,
  getTabsLayoutRedirect,
  normalizeOnboardingStep,
  ONBOARDING_PATHS,
} from "@/src/features/auth/domain/auth-navigation";
import type { StoredAuthSession } from "@/src/features/auth/domain/auth.types";
import { createAuthFetchRepository } from "@/src/features/auth/infrastructure/auth-fetch-repository";
import { normalizeStoredAuthSession } from "@/src/features/auth/infrastructure/session-storage";

const user = (
  registrationStatus: AuthUser["registrationStatus"],
): AuthUser => ({
  id: "user-1",
  email: "user@example.test",
  fullName: "User",
  role: "tendero",
  active: true,
  emailVerifiedAt: "2026-09-15T00:00:00.000Z",
  registrationStatus,
});

const storedSession = (): StoredAuthSession => ({
  user: user("store_required"),
  session: {
    accessToken: "old-access",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 120_000,
  },
  onboardingDraft: { storeName: "Store" },
  onboardingStep: "location-permissions",
});

function sameGeneration(
  current: StoredAuthSession | null,
  expected: StoredAuthSession,
) {
  return (
    current?.user.id === expected.user.id &&
    current.session.accessToken === expected.session.accessToken &&
    current.session.refreshToken === expected.session.refreshToken
  );
}

function memorySessionRepository(initial: StoredAuthSession | null) {
  let current = initial;
  const repository = {
    load: jest.fn(async () => current),
    save: jest.fn(async (value: StoredAuthSession | null) => {
      current = value;
    }),
    saveIfCurrent: jest.fn(
      async (expected: StoredAuthSession, value: StoredAuthSession | null) => {
        if (!sameGeneration(current, expected)) return false;
        current = value;
        return true;
      },
    ),
  } satisfies AuthSessionRepository;

  return {
    repository,
    get: () => current,
    set: (value: StoredAuthSession | null) => {
      current = value;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("OTP input and resend logic", () => {
  it("normalizes typing, paste, and autofill to one six-digit value", () => {
    expect(normalizeOtpCode("12 34-56")).toBe("123456");
    expect(normalizeOtpCode("123456789")).toBe("123456");
    expect(normalizeOtpCode("abc")).toBe("");
  });

  it("locks a resend synchronously until the active request releases it", () => {
    const lock = createSynchronousLock();

    expect(lock.tryAcquire()).toBe(true);
    expect(lock.tryAcquire()).toBe(false);
    lock.release();
    expect(lock.tryAcquire()).toBe(true);
  });

  it("derives resend deadlines from server cooldowns and retry windows", () => {
    expect(getOtpDeadline(1_000, { success: true, cooldownSeconds: 30 })).toBe(
      31_000,
    );
    expect(
      getOtpDeadline(1_000, { success: false, retryAfterSeconds: 12 }),
    ).toBe(13_000);
  });
});

describe("OTP HTTP classification", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns sent with the server cooldown after a successful request", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ challengeId: "challenge-1", cooldownSeconds: 30 }),
    } as Response);

    await expect(
      createAuthFetchRepository().requestOtp("user@example.test"),
    ).resolves.toEqual({
      success: true,
      state: "sent",
      challengeId: "challenge-1",
      cooldownSeconds: 30,
    });
  });

  it("classifies rate limits and preserves Retry-After", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "17" }),
      json: async () => ({
        error: "slow down",
        code: "rate_limited",
        details: { retryAfterSeconds: 12 },
      }),
    } as Response);

    await expect(
      createAuthFetchRepository().requestOtp("user@example.test"),
    ).resolves.toEqual({
      success: false,
      state: "rate_limited",
      retryAfterSeconds: 17,
      error: "slow down",
    });
  });

  it.each(["incorrect_code", "expired_code"] as const)(
    "preserves the %s verification state",
    async (code) => {
      jest.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({ error: code, code }),
      } as Response);

      await expect(
        createAuthFetchRepository().verifyOtp(
          "user@example.test",
          "challenge-1",
          "123456",
        ),
      ).resolves.toEqual({
        success: false,
        state: code,
        retryAfterSeconds: undefined,
        error: code,
      });
    },
  );

  it("classifies provider and offline request failures", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
        json: async () => ({
          error: "provider unavailable",
          code: "provider_error",
        }),
      } as Response)
      .mockRejectedValueOnce(new Error("offline"));
    const repository = createAuthFetchRepository();

    await expect(repository.requestOtp("user@example.test")).resolves.toEqual({
      success: false,
      state: "provider_error",
      retryAfterSeconds: undefined,
      error: "provider unavailable",
    });
    await expect(repository.requestOtp("user@example.test")).resolves.toEqual({
      success: false,
      state: "offline",
      error: expect.any(String),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("auth navigation", () => {
  it("does not expose the removed identity-card onboarding step", () => {
    expect(ONBOARDING_PATHS.has("/auth/identity-card")).toBe(false);
  });

  it("uses registrationStatus as the global routing authority", () => {
    expect(getCanonicalAuthPath(null, null, null)).toBe("/auth/welcome");
    expect(getCanonicalAuthPath(user("profile_required"), null, null)).toBe(
      "/auth/person-name",
    );
    expect(
      getCanonicalAuthPath(
        user("store_required"),
        { storeName: "Store" },
        "location-permissions",
      ),
    ).toBe("/auth/location-permissions");
    expect(getCanonicalAuthPath(user("completed"), null, "person-name")).toBe(
      "/(tabs)",
    );
  });

  it("rejects a local substep whose prerequisites are missing", () => {
    expect(
      normalizeOnboardingStep(user("store_required"), null, "store-photos"),
    ).toBe("store-name");
    expect(
      normalizeOnboardingStep(
        user("store_required"),
        { storeName: "Store" },
        "account-created",
      ),
    ).toBe("location-permissions");
  });

  it("migrates a legacy persisted session to a safe canonical substep", () => {
    const legacy = storedSession();
    const migrated = normalizeStoredAuthSession({
      user: legacy.user,
      session: legacy.session,
      onboardingDraft: {
        storeName: "Store",
        address: "Main street",
        latitude: -0.2,
        longitude: -78.5,
        photos: [],
      },
    });

    expect(migrated?.onboardingStep).toBe("account-created");
  });

  it("keeps a pre-registrationStatus session out of tabs until server sync", () => {
    const legacy = storedSession();
    const { registrationStatus: _registrationStatus, ...legacyUser } =
      legacy.user;
    const migrated = normalizeStoredAuthSession({
      user: legacyUser,
      session: legacy.session,
    });

    expect(migrated?.user.registrationStatus).toBe("profile_required");
    expect(
      getCanonicalAuthPath(
        migrated?.user ?? null,
        migrated?.onboardingDraft ?? null,
        migrated?.onboardingStep ?? null,
      ),
    ).toBe("/auth/person-name");
  });

  it("guards onboarding deep links for signed-out users", () => {
    expect(
      getAuthLayoutRedirect(
        "/auth/store-photos",
        null,
        { storeName: "Store" },
        "store-photos",
      ),
    ).toBe("/auth/welcome");
    expect(
      getAuthLayoutRedirect("/auth/enter-email", null, null, null),
    ).toBeNull();
  });

  it("redirects completed users away from auth routes and allows tabs", () => {
    const completed = user("completed");

    expect(getAuthLayoutRedirect("/auth/welcome", completed, null, null)).toBe(
      "/(tabs)",
    );
    expect(getTabsLayoutRedirect(completed, null, null)).toBeNull();
  });

  it.each([
    [user("profile_required"), null, null, "/auth/person-name"],
    [user("store_required"), null, "store-name" as const, "/auth/store-name"],
  ])(
    "keeps incomplete users out of tabs",
    (incompleteUser, draft, step, expectedPath) => {
      expect(getTabsLayoutRedirect(incompleteUser, draft, step)).toBe(
        expectedPath,
      );
    },
  );

  it("allows only the search-location substep for the matching canonical step", () => {
    const storeUser = user("store_required");
    const draft = { storeName: "Store" };

    expect(
      getAuthLayoutRedirect(
        "/auth/search-location",
        storeUser,
        draft,
        "business-location",
      ),
    ).toBeNull();
    expect(
      getAuthLayoutRedirect(
        "/auth/search-location",
        storeUser,
        draft,
        "store-photos",
      ),
    ).toBe("/auth/location-permissions");
  });
});

describe("protected auth requests", () => {
  it("refreshes only after 401, persists rotation, and retries once", async () => {
    const events: string[] = [];
    const stored = storedSession();
    const request = jest
      .fn()
      .mockImplementationOnce(async (token: string) => {
        events.push(`request:${token}`);
        return {
          success: false as const,
          error: "expired",
          status: 401,
          unauthorized: true,
        };
      })
      .mockImplementationOnce(async (token: string) => {
        events.push(`request:${token}`);
        return { success: true as const, data: "ok" };
      });
    const remoteRepository = {
      refreshSession: jest.fn(async () => {
        events.push("refresh");
        return {
          success: true as const,
          session: {
            accessToken: "new-access",
            refreshToken: "new-refresh",
            expiresIn: 900,
          },
        };
      }),
    } as unknown as AuthRemoteRepository;
    const sessions = memorySessionRepository(stored);
    const saveIfCurrent = sessions.repository.saveIfCurrent;
    const sessionRepository = {
      ...sessions.repository,
      saveIfCurrent: jest.fn(
        async (
          expected: StoredAuthSession,
          value: StoredAuthSession | null,
        ) => {
          events.push(`save:${value?.session.accessToken ?? "null"}`);
          return saveIfCurrent(expected, value);
        },
      ),
      save: jest.fn(async (value: StoredAuthSession | null) => {
        events.push(`save:${value?.session.accessToken ?? "null"}`);
      }),
    } satisfies AuthSessionRepository;

    const result = await executeProtectedAuthRequest({
      stored,
      remoteRepository,
      sessionRepository,
      request,
    });

    expect(result.result).toEqual({ success: true, data: "ok" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      "request:old-access",
      "refresh",
      "save:new-access",
      "request:new-access",
    ]);
  });

  it("reuses a completed concurrent rotation without refreshing the old token again", async () => {
    const stored = storedSession();
    const sessions = memorySessionRepository(stored);
    const refreshStarted = deferred<void>();
    const refreshResult = deferred<{
      success: true;
      session: {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };
    }>();
    const secondUnauthorized = deferred<void>();
    const remoteRepository = {
      refreshSession: jest.fn(() => {
        refreshStarted.resolve();
        return refreshResult.promise;
      }),
    } as unknown as AuthRemoteRepository;
    const firstRequest = jest
      .fn()
      .mockResolvedValueOnce({
        success: false as const,
        error: "expired",
        status: 401,
        unauthorized: true,
      })
      .mockResolvedValueOnce({ success: true as const, data: "first" });
    const secondRequest = jest
      .fn()
      .mockImplementationOnce(async () => {
        await secondUnauthorized.promise;
        return {
          success: false as const,
          error: "expired",
          status: 401,
          unauthorized: true,
        };
      })
      .mockResolvedValueOnce({ success: true as const, data: "second" });

    const firstExecution = executeProtectedAuthRequest({
      stored,
      remoteRepository,
      sessionRepository: sessions.repository,
      request: firstRequest,
    });
    await refreshStarted.promise;
    const secondExecution = executeProtectedAuthRequest({
      stored,
      remoteRepository,
      sessionRepository: sessions.repository,
      request: secondRequest,
    });

    refreshResult.resolve({
      success: true,
      session: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 900,
      },
    });
    await expect(firstExecution).resolves.toMatchObject({
      result: { success: true, data: "first" },
    });
    secondUnauthorized.resolve();
    await expect(secondExecution).resolves.toMatchObject({
      result: { success: true, data: "second" },
    });

    expect(remoteRepository.refreshSession).toHaveBeenCalledTimes(1);
    expect(secondRequest).toHaveBeenNthCalledWith(2, "new-access");
  });

  it.each([
    ["logout", null],
    [
      "session replacement",
      {
        ...storedSession(),
        user: { ...storedSession().user, id: "user-2" },
        session: {
          ...storedSession().session,
          accessToken: "other-access",
          refreshToken: "other-refresh",
        },
      },
    ],
  ] as const)(
    "does not persist or retry after %s during refresh",
    async (_label, replacement) => {
      const stored = storedSession();
      const sessions = memorySessionRepository(stored);
      const refreshStarted = deferred<void>();
      const refreshResult = deferred<{
        success: true;
        session: {
          accessToken: string;
          refreshToken: string;
          expiresIn: number;
        };
      }>();
      const remoteRepository = {
        refreshSession: jest.fn(() => {
          refreshStarted.resolve();
          return refreshResult.promise;
        }),
      } as unknown as AuthRemoteRepository;
      const request = jest.fn(async () => ({
        success: false as const,
        error: "expired",
        status: 401,
        unauthorized: true,
      }));

      const execution = executeProtectedAuthRequest({
        stored,
        remoteRepository,
        sessionRepository: sessions.repository,
        request,
      });
      await refreshStarted.promise;
      sessions.set(replacement);
      refreshResult.resolve({
        success: true,
        session: {
          accessToken: "late-access",
          refreshToken: "late-refresh",
          expiresIn: 900,
        },
      });

      await expect(execution).resolves.toMatchObject({ stored: replacement });
      expect(request).toHaveBeenCalledTimes(1);
      expect(sessions.repository.saveIfCurrent).not.toHaveBeenCalled();
      expect(sessions.get()).toBe(replacement);
    },
  );

  it("stops after a 401 from the only retry", async () => {
    const stored = storedSession();
    const sessions = memorySessionRepository(stored);
    const request = jest.fn(async () => ({
      success: false as const,
      error: "expired",
      status: 401,
      unauthorized: true,
    }));
    const remoteRepository = {
      refreshSession: jest.fn(async () => ({
        success: true as const,
        session: {
          accessToken: "new-access",
          refreshToken: "new-refresh",
          expiresIn: 900,
        },
      })),
    } as unknown as AuthRemoteRepository;

    const execution = await executeProtectedAuthRequest({
      stored,
      remoteRepository,
      sessionRepository: sessions.repository,
      request,
    });

    expect(execution.result).toMatchObject({ success: false, status: 401 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(remoteRepository.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("does not refresh or retry for non-401 failures", async () => {
    const request = jest.fn(async () => ({
      success: false as const,
      error: "busy",
      status: 503,
      unauthorized: false,
    }));
    const remoteRepository = {
      refreshSession: jest.fn(),
    } as unknown as AuthRemoteRepository;
    const sessionRepository = {
      load: jest.fn(),
      save: jest.fn(),
      saveIfCurrent: jest.fn(),
    } satisfies AuthSessionRepository;

    await executeProtectedAuthRequest({
      stored: storedSession(),
      remoteRepository,
      sessionRepository,
      request,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(remoteRepository.refreshSession).not.toHaveBeenCalled();
    expect(sessionRepository.save).not.toHaveBeenCalled();
  });
});

describe("final protected-operation persistence", () => {
  it("does not restore a logged-out session after profile update succeeds remotely", async () => {
    const stored = storedSession();
    const sessions = memorySessionRepository(stored);
    const remoteRepository = {
      updateProfile: jest.fn(async () => {
        sessions.set(null);
        return {
          success: true as const,
          data: user("store_required"),
        };
      }),
    } as unknown as AuthRemoteRepository;
    const updateProfile = createUpdateAuthProfileUseCase({
      remoteRepository,
      sessionRepository: sessions.repository,
    });

    const result = await updateProfile(stored, {
      name: "Updated User",
      storeName: "Store",
    });

    expect(result).toEqual({
      success: false,
      error: "La sesión cambió. Intenta nuevamente.",
      stored: null,
    });
    expect(sessions.repository.saveIfCurrent).toHaveBeenCalledTimes(1);
    expect(sessions.get()).toBeNull();
  });

  it("does not overwrite a replacement session after registration completes remotely", async () => {
    const stored = storedSession();
    const replacement = {
      ...storedSession(),
      user: { ...storedSession().user, id: "user-2" },
      session: {
        ...storedSession().session,
        accessToken: "other-access",
        refreshToken: "other-refresh",
      },
    } satisfies StoredAuthSession;
    const sessions = memorySessionRepository(stored);
    const remoteRepository = {
      completeRegistration: jest.fn(async () => {
        sessions.set(replacement);
        return {
          success: true as const,
          data: { user: user("completed"), storeId: "store-1" },
        };
      }),
    } as unknown as AuthRemoteRepository;
    const completeRegistration = createCompleteAuthRegistrationUseCase({
      remoteRepository,
      sessionRepository: sessions.repository,
    });

    const result = await completeRegistration(stored);

    expect(result).toEqual({
      success: false,
      error: "La sesión cambió. Intenta nuevamente.",
      stored: replacement,
    });
    expect(sessions.repository.saveIfCurrent).toHaveBeenCalledTimes(1);
    expect(sessions.get()).toBe(replacement);
  });
});

describe("refresh HTTP classification", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    [400, true],
    [401, true],
    [429, false],
    [500, false],
  ])("classifies HTTP %i with terminal=%s", async (status, terminal) => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status,
      json: async () => ({ error: `status-${status}` }),
    } as Response);

    await expect(
      createAuthFetchRepository().refreshSession(`refresh-${status}`),
    ).resolves.toEqual({
      success: false,
      error: `status-${status}`,
      status,
      terminal,
    });
  });

  it("classifies network failures as transient", async () => {
    jest.spyOn(global, "fetch").mockRejectedValueOnce(new Error("offline"));

    await expect(
      createAuthFetchRepository().refreshSession("refresh-network"),
    ).resolves.toEqual({
      success: false,
      error: "No se pudo conectar con el servidor.",
      terminal: false,
    });
  });

  it("single-flights refreshes per token without mixing token generations", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        session: {
          accessToken: "new-access",
          refreshToken: "new-refresh",
          expiresIn: 900,
        },
      }),
    } as Response);
    const repository = createAuthFetchRepository();

    await Promise.all([
      repository.refreshSession("shared-token"),
      repository.refreshSession("shared-token"),
      repository.refreshSession("other-token"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ refreshToken: "shared-token" }),
      JSON.stringify({ refreshToken: "other-token" }),
    ]);
  });

  it("prunes successful refresh results after the rotation reuse window", async () => {
    let now = 1_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        session: {
          accessToken: "new-access",
          refreshToken: "new-refresh",
          expiresIn: 900,
        },
      }),
    } as Response);
    const repository = createAuthFetchRepository();

    await repository.refreshSession("expiring-token");
    now += 60_001;
    await repository.refreshSession("cleanup-trigger");
    await repository.refreshSession("expiring-token");

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("session initialization", () => {
  it("keeps a persisted session when refresh fails transiently", async () => {
    const stored = {
      ...storedSession(),
      session: { ...storedSession().session, expiresAt: Date.now() - 1 },
    };
    const sessionRepository = {
      load: jest.fn(async () => stored),
      save: jest.fn(),
      saveIfCurrent: jest.fn(),
    } satisfies AuthSessionRepository;
    const remoteRepository = {
      refreshSession: jest.fn(async () => ({
        success: false as const,
        error: "rate limited",
        status: 429,
        terminal: false,
      })),
    } as unknown as AuthRemoteRepository;

    const initialize = createInitializeAuthSessionUseCase({
      remoteRepository,
      sessionRepository,
    });

    await expect(initialize()).resolves.toBe(stored);
    expect(sessionRepository.save).not.toHaveBeenCalled();
  });

  it("clears a persisted session only for terminal refresh rejection", async () => {
    const stored = {
      ...storedSession(),
      session: { ...storedSession().session, expiresAt: Date.now() - 1 },
    };
    const sessionRepository = {
      load: jest.fn(async () => stored),
      save: jest.fn(),
      saveIfCurrent: jest.fn(async () => true),
    } satisfies AuthSessionRepository;
    const remoteRepository = {
      refreshSession: jest.fn(async () => ({
        success: false as const,
        error: "invalid refresh token",
        status: 401,
        terminal: true,
      })),
    } as unknown as AuthRemoteRepository;

    const initialize = createInitializeAuthSessionUseCase({
      remoteRepository,
      sessionRepository,
    });

    await expect(initialize()).resolves.toBeNull();
    expect(sessionRepository.saveIfCurrent).toHaveBeenCalledWith(stored, null);
  });
});
