import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  AuthOnboardingDraft,
  AuthOnboardingStep,
  AuthPaymentMethod,
  AuthSessionState,
  StoredAuthSession,
} from "../domain/auth.types";
import { createAuthUseCases } from "../application/auth.use-cases";
import {
  authorizedFetch,
  createAuthFetchRepository,
} from "../infrastructure/auth-fetch-repository";
import { createSecureStoreAuthSessionRepository } from "../infrastructure/session-storage";
import {
  createStorePhotosUploadDeps,
  fetchOwnStoreId,
  type AuthenticatedJsonRequest,
} from "../infrastructure/store-photos-fetch-repository";
import { executeProtectedAuthRequest } from "../application/use-cases/execute-protected-auth-request";
import { uploadStorePhotos } from "../application/use-cases/upload-store-photos.use-case";
import type {
  AuthContextType,
  SaveLocationInput,
  SavePaymentMethodInput,
  SaveProfileInput,
} from "./auth-context.types";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const authRemoteRepository = createAuthFetchRepository();
const authSessionRepository = createSecureStoreAuthSessionRepository();
const authUseCases = createAuthUseCases({
  remoteRepository: authRemoteRepository,
  sessionRepository: authSessionRepository,
});

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<StoredAuthSession["user"] | null>(null);
  const [onboardingDraft, setOnboardingDraft] =
    useState<AuthOnboardingDraft | null>(null);
  const [onboardingStep, setOnboardingStepState] =
    useState<AuthOnboardingStep | null>(null);
  const [sessionAccessToken, setSessionAccessToken] = useState<string | null>(
    null,
  );
  const [sessionRefreshToken, setSessionRefreshToken] = useState<string | null>(
    null,
  );
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [isReady, setIsReady] = useState(false);

  const syncStoredSession = (stored: StoredAuthSession | null) => {
    if (!stored) {
      setUser(null);
      setOnboardingDraft(null);
      setOnboardingStepState(null);
      setSessionAccessToken(null);
      setSessionRefreshToken(null);
      setSessionExpiresAt(null);
      return;
    }

    setUser(stored.user);
    setOnboardingDraft(stored.onboardingDraft);
    setOnboardingStepState(stored.onboardingStep);
    setSessionAccessToken(stored.session.accessToken);
    setSessionRefreshToken(stored.session.refreshToken);
    setSessionExpiresAt(stored.session.expiresAt);
  };

  const getStoredSession = (): StoredAuthSession | null => {
    if (!user || !sessionAccessToken) return null;

    return {
      user,
      onboardingDraft,
      onboardingStep,
      session: {
        accessToken: sessionAccessToken,
        refreshToken: sessionRefreshToken,
        expiresAt: sessionExpiresAt,
      } satisfies AuthSessionState,
    } satisfies StoredAuthSession;
  };

  const persistCurrentSession = async (
    nextStored: StoredAuthSession | null,
  ) => {
    await authUseCases.persistAuthSession(nextStored);
    syncStoredSession(nextStored);
  };

  useEffect(() => {
    (async () => {
      try {
        const stored = await authUseCases.initializeAuthSession();
        syncStoredSession(stored);
      } catch {
        syncStoredSession(null);
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  /**
   * Runs one authenticated request against an explicit session instead of the
   * component state, so a caller that just received a fresher session (such as
   * `completeRegistration`) does not reuse a stale closure.
   */
  const runAuthenticatedRequest = async (
    stored: StoredAuthSession,
    path: string,
    init: RequestInit = {},
  ) => {
    const outcome = await executeProtectedAuthRequest({
      stored,
      remoteRepository: authRemoteRepository,
      sessionRepository: authSessionRepository,
      request: async (accessToken) => {
        try {
          const response = await authorizedFetch(accessToken, path, init);
          if (response.ok) return { success: true as const, data: response };
          const data = await response.json().catch(() => ({}));
          return {
            success: false as const,
            error: data.error ?? "No se pudo completar la solicitud.",
            status: response.status,
            unauthorized: response.status === 401,
          };
        } catch {
          return {
            success: false as const,
            error: "No se pudo conectar con el servidor.",
            unauthorized: false,
          };
        }
      },
    });

    if (outcome.stored !== stored) syncStoredSession(outcome.stored ?? null);
    if (!outcome.result.success) {
      return { success: false as const, error: outcome.result.error };
    }
    return { success: true as const, response: outcome.result.data };
  };

  /**
   * Uploads the given local photo URIs to the store's own Garage prefix and
   * returns the ones that did not make it, so they can stay in the onboarding
   * draft for a later attempt.
   */
  const uploadPendingPhotos = async (
    stored: StoredAuthSession,
    storeId: string,
    uris: string[],
  ): Promise<string[]> => {
    if (!uris.length) return [];
    const request: AuthenticatedJsonRequest = (path, init) =>
      runAuthenticatedRequest(stored, path, init);
    const result = await uploadStorePhotos({
      storeId,
      uris,
      deps: createStorePhotosUploadDeps(request),
    });
    return result.failed;
  };

  const saveProfile = async (data: SaveProfileInput) => {
    const stored = getStoredSession();
    if (!stored) return { success: false, error: "Sesión no encontrada." };

    const result = await authUseCases.updateAuthProfile(stored, data);
    if ("stored" in result) syncStoredSession(result.stored ?? null);
    return { success: result.success, error: result.error };
  };

  const savePhotos = async (uris: string[]) => {
    const stored = getStoredSession();
    if (!stored) return { success: false, error: "Sesión no encontrada." };

    // The store exists only once registration completes, so during first-time
    // onboarding there is nothing to upload into yet. The URIs then stay in the
    // draft and `completeRegistration` uploads them the moment the store is
    // created, which is what makes the photos survive a reinstall.
    const storeId = uris.length
      ? await fetchOwnStoreId((path, init) =>
          runAuthenticatedRequest(stored, path, init),
        )
      : null;
    const pendingPhotos = storeId
      ? await uploadPendingPhotos(stored, storeId, uris)
      : uris;

    const nextStored = {
      ...stored,
      onboardingDraft: {
        ...(stored.onboardingDraft ?? {}),
        photos: pendingPhotos,
      },
      onboardingStep: "account-created",
    } satisfies StoredAuthSession;

    await persistCurrentSession(nextStored);
    return { success: true };
  };

  const setOnboardingStep = async (step: AuthOnboardingStep) => {
    const stored = getStoredSession();
    if (!stored) return { success: false, error: "Sesión no encontrada." };
    const nextStored = { ...stored, onboardingStep: step };
    await persistCurrentSession(nextStored);
    return { success: true };
  };

  const savePaymentMethod = async (data: SavePaymentMethodInput) => {
    const stored = getStoredSession();
    if (!stored) return { success: false, error: "Sesión no encontrada." };

    const nextStored = {
      ...stored,
      onboardingDraft: {
        ...(stored.onboardingDraft ?? {}),
        paymentMethod: data.method,
      },
    } satisfies StoredAuthSession;

    await persistCurrentSession(nextStored);
    return { success: true };
  };

  const logout = async () => {
    await authUseCases.logoutAuth(getStoredSession());
    syncStoredSession(null);
  };

  const requestOTP = async (email: string) => {
    return authUseCases.requestAuthOtp(email);
  };

  const verifyOTP = async (
    email: string,
    challengeId: string,
    code: string,
  ) => {
    const result = await authUseCases.verifyAuthOtp(email, challengeId, code);
    if (result.stored) syncStoredSession(result.stored);
    return {
      success: result.success,
      user: result.stored?.user,
      state: result.state,
      retryAfterSeconds: result.retryAfterSeconds,
      error: result.error,
    };
  };

  const saveLocation = async (data: SaveLocationInput) => {
    const stored = getStoredSession();
    if (!stored) return { success: false, error: "Sesión no encontrada." };

    const nextStored = {
      ...stored,
      onboardingDraft: {
        ...(stored.onboardingDraft ?? {}),
        ...data,
      },
      onboardingStep: "store-photos",
    } satisfies StoredAuthSession;

    await persistCurrentSession(nextStored);
    return { success: true };
  };

  const completeRegistration = async () => {
    const stored = getStoredSession();
    const pendingPhotos = stored?.onboardingDraft?.photos ?? [];
    const result = await authUseCases.completeAuthRegistration(stored);

    if ("stored" in result) syncStoredSession(result.stored ?? null);

    // The store now exists, so the onboarding photos finally have a home. A
    // failed upload never fails the registration: photos are optional and the
    // tendero can add them again from the app.
    const completedStored = result.stored;
    const storeId = result.data?.storeId;
    if (result.success && completedStored && storeId && pendingPhotos.length) {
      await uploadPendingPhotos(completedStored, storeId, pendingPhotos);
    }

    return { success: result.success, error: result.error };
  };

  const requestAuthenticated = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const stored = getStoredSession();
      if (!stored) {
        return { success: false as const, error: "Sesión no encontrada." };
      }

      return runAuthenticatedRequest(stored, path, init);
    },
    [
      user,
      onboardingDraft,
      onboardingStep,
      sessionAccessToken,
      sessionRefreshToken,
      sessionExpiresAt,
    ],
  );

  const value = useMemo(
    () => ({
      isLoggedIn: user !== null,
      user,
      onboardingDraft,
      onboardingStep,
      isReady,
      saveProfile,
      savePhotos,
      savePaymentMethod,
      saveLocation,
      setOnboardingStep,
      requestOTP,
      verifyOTP,
      completeRegistration,
      requestAuthenticated,
      logout,
    }),
    [user, onboardingDraft, onboardingStep, isReady, requestAuthenticated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
