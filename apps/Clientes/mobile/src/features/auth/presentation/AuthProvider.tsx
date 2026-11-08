import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "@repo/api-contracts";

import { getOtpFailureMessage } from "../application/otp-flow";
import type { AuthRemoteResult } from "../application/ports";
import { createAuthUseCases } from "../application/use-cases";
import type { StoredAuthSession } from "../domain/auth.types";
import {
  composeFullName,
  deriveGate,
  hasName,
  type GateState,
  type ProfileState,
} from "../domain/profile-gate";
import { createAuthFetchRepository } from "../infrastructure/auth-fetch-repository";
import { createSecureStoreAuthSessionRepository } from "../infrastructure/session-storage";

const authUseCases = createAuthUseCases({
  remoteRepository: createAuthFetchRepository(),
  sessionRepository: createSecureStoreAuthSessionRepository(),
});

export type SaveProfileInput = {
  name: string;
  surname: string;
  birthDate: string;
};

export type SaveProfileResult =
  | { success: true }
  | { success: false; reason: "underage" | "failed" | "stale" };

/**
 * What a feature learns from an authenticated request. `ignored` covers every
 * case where the answer must not be used: no open gate, a logout or newer
 * login while it ran, a lost session, or a 403 that sent the customer back
 * through the profile gate.
 */
export type ProtectedOutcome<T> =
  | { status: "ok"; data: T }
  | { status: "failed"; httpStatus?: number }
  | { status: "ignored" };

const IGNORED = { status: "ignored" } as const;

type AuthContextType = {
  isReady: boolean;
  gate: GateState;
  user: AuthUser | null;
  requestOTP: (
    email: string,
  ) => ReturnType<typeof authUseCases.requestAuthOtp>;
  verifyOTP: (
    email: string,
    challengeId: string,
    code: string,
  ) => ReturnType<typeof authUseCases.verifyAuthOtp>;
  saveProfile: (input: SaveProfileInput) => Promise<SaveProfileResult>;
  retryProfile: () => Promise<void>;
  runProtected: <T>(
    request: (accessToken: string) => Promise<AuthRemoteResult<T>>,
  ) => Promise<ProtectedOutcome<T>>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [stored, setStoredState] = useState<StoredAuthSession | null>(null);
  const [profileState, setProfileStateValue] = useState<ProfileState>({
    status: "idle",
  });
  const [isReady, setIsReady] = useState(false);

  // Refs hold the latest values for async work that outlives a render.
  const storedRef = useRef<StoredAuthSession | null>(null);
  const profileRef = useRef<ProfileState>({ status: "idle" });
  // Bumped whenever the signed-in identity changes (login, logout, terminal
  // session loss). Async work started under an older epoch is discarded, so it
  // can never revive a logged-out session or touch a newer one.
  const epochRef = useRef(0);

  const setStored = (next: StoredAuthSession | null) => {
    storedRef.current = next;
    setStoredState(next);
  };
  const setProfile = (next: ProfileState) => {
    profileRef.current = next;
    setProfileStateValue(next);
  };

  /** Applies the session an authenticated request ended with. */
  const applyOutcomeSession = (
    sent: StoredAuthSession,
    outcome: StoredAuthSession | null,
  ) => {
    if (outcome === sent) return;
    if (!outcome) {
      epochRef.current += 1;
      setStored(null);
      setProfile({ status: "idle" });
      return;
    }
    if (outcome.user.id === sent.user.id) setStored(outcome);
  };

  /**
   * `afterForbidden` is set only when a feature request was refused with 403
   * and the server is being asked again. If it then calls the profile
   * eligible, the two answers contradict each other: reopening the tabs would
   * repeat the same refused request forever, so the customer lands on the
   * recoverable profile error and only an explicit retry opens the gate again.
   */
  const loadProfile = async (
    session: StoredAuthSession,
    epoch: number,
    afterForbidden = false,
  ) => {
    if (session.user.role !== "client") {
      setProfile({ status: "idle" });
      return;
    }
    setProfile({ status: "loading" });

    const outcome = await authUseCases.loadProfile(session);
    if (epoch !== epochRef.current) return;

    applyOutcomeSession(session, outcome.stored);
    if (!outcome.stored) return;

    const { result } = outcome;
    if (result.success) {
      const contradicts =
        afterForbidden &&
        result.data.eligibility === "eligible" &&
        hasName(result.data.fullName);
      setProfile(
        contradicts
          ? { status: "error" }
          : { status: "loaded", profile: result.data },
      );
    } else if (result.status === 403 && !result.eligibility) {
      setProfile({ status: "forbidden" });
    } else {
      setProfile({ status: "error" });
    }
  };

  useEffect(() => {
    const epoch = epochRef.current;
    (async () => {
      try {
        const restored = await authUseCases.initializeAuthSession();
        if (epoch !== epochRef.current) return;
        setStored(restored);
        if (restored) void loadProfile(restored, epoch);
      } catch {
        if (epoch === epochRef.current) setStored(null);
      } finally {
        setIsReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthContextType>(() => {
    const requestOTP: AuthContextType["requestOTP"] = (email) =>
      authUseCases.requestAuthOtp(email);

    const verifyOTP: AuthContextType["verifyOTP"] = async (
      email,
      challengeId,
      code,
    ) => {
      const startEpoch = epochRef.current;
      const result = await authUseCases.verifyAuthOtp(
        email,
        challengeId,
        code,
        () => epochRef.current === startEpoch,
      );
      if (result.success && epochRef.current !== startEpoch) {
        // Logout or a newer login happened after the write: undo only this
        // verification's own session and report it as not started.
        await authUseCases.discardSession(result.stored);
        return {
          success: false as const,
          state: "provider_error" as const,
          retryAfterSeconds: undefined,
          error: getOtpFailureMessage("provider_error"),
          stored: undefined,
        };
      }
      if (result.success) {
        const epoch = ++epochRef.current;
        setStored(result.stored);
        void loadProfile(result.stored, epoch);
      }
      return result;
    };

    const saveProfile = async (
      input: SaveProfileInput,
    ): Promise<SaveProfileResult> => {
      const session = storedRef.current;
      if (!session) return { success: false, reason: "failed" };
      const epoch = epochRef.current;

      // A saved name is sent back untouched; only a customer without one
      // composes it from the new name and optional surname.
      const current = profileRef.current;
      const savedName =
        current.status === "loaded" && hasName(current.profile.fullName)
          ? current.profile.fullName
          : null;
      const fullName =
        savedName ?? composeFullName(input.name, input.surname);
      if (!hasName(fullName)) return { success: false, reason: "failed" };

      const outcome = await authUseCases.saveProfile(session, {
        fullName,
        birthDate: input.birthDate,
      });
      if (epoch !== epochRef.current) return { success: false, reason: "stale" };

      applyOutcomeSession(session, outcome.stored);
      if (!outcome.stored) return { success: false, reason: "failed" };

      const { result } = outcome;
      if (result.success) {
        setProfile({ status: "loaded", profile: result.data });
        return { success: true };
      }
      // A refused save never changes what the app believes about the profile.
      return {
        success: false,
        reason: result.eligibility === "underage" ? "underage" : "failed",
      };
    };

    const retryProfile = async () => {
      const session = storedRef.current;
      if (!session) return;
      await loadProfile(session, epochRef.current);
    };

    const runProtected: AuthContextType["runProtected"] = async (request) => {
      const session = storedRef.current;
      if (!session || session.user.role !== "client") return IGNORED;
      const gateNow = deriveGate({
        isReady: true,
        user: session.user,
        profileState: profileRef.current,
      });
      if (gateNow.status !== "ready") return IGNORED;
      const epoch = epochRef.current;

      const outcome = await authUseCases.runProtected(session, request);
      if (epoch !== epochRef.current) return IGNORED;

      applyOutcomeSession(session, outcome.stored);
      if (outcome.stored?.user.id !== session.user.id) return IGNORED;

      const { result } = outcome;
      if (result.success) return { status: "ok", data: result.data };
      if (result.status === 403 && result.eligibility !== "eligible") {
        // The server no longer agrees with the profile the gate opened on:
        // hold the tabs and ask the server again, never guess a profile.
        await loadProfile(outcome.stored, epoch, true);
        return IGNORED;
      }
      return { status: "failed", httpStatus: result.status };
    };

    const logout = async () => {
      const session = storedRef.current;
      epochRef.current += 1;
      setStored(null);
      setProfile({ status: "idle" });
      await authUseCases.logoutAuth(session);
    };

    return {
      isReady,
      gate: deriveGate({
        isReady,
        user: stored?.user ?? null,
        profileState,
      }),
      user: stored?.user ?? null,
      requestOTP,
      verifyOTP,
      saveProfile,
      retryProfile,
      runProtected,
      logout,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, stored, profileState]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
