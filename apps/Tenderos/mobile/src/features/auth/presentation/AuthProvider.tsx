import {
  createContext,
  useContext,
  useEffect,
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
import { createAuthFetchRepository } from "../infrastructure/auth-fetch-repository";
import { createSecureStoreAuthSessionRepository } from "../infrastructure/session-storage";
import type {
  AuthContextType,
  SaveLocationInput,
  SavePaymentMethodInput,
  SaveProfileInput,
} from "./auth-context.types";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const authUseCases = createAuthUseCases({
  remoteRepository: createAuthFetchRepository(),
  sessionRepository: createSecureStoreAuthSessionRepository(),
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

    const nextStored = {
      ...stored,
      onboardingDraft: {
        ...(stored.onboardingDraft ?? {}),
        photos: uris,
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
    const result =
      await authUseCases.completeAuthRegistration(getStoredSession());

    if ("stored" in result) syncStoredSession(result.stored ?? null);
    return { success: result.success, error: result.error };
  };

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
      logout,
    }),
    [user, onboardingDraft, onboardingStep, isReady],
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
