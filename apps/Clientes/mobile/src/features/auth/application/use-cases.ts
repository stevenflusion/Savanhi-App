import type { CustomerProfileUpdateRequest } from "@repo/api-contracts";

import type { StoredAuthSession } from "../domain/auth.types";
import type { AuthRemoteRepository, AuthSessionRepository } from "./ports";

import { SESSION_REFRESH_MARGIN_MS, toSession, toStoredAuthSession } from "./auth-session.utils";
import { executeProtectedAuthRequest } from "./execute-protected-auth-request";
import { getOtpFailureMessage } from "./otp-flow";

type AuthUseCaseDeps = {
  remoteRepository: AuthRemoteRepository;
  sessionRepository: AuthSessionRepository;
};

export function createAuthUseCases({
  remoteRepository,
  sessionRepository,
}: AuthUseCaseDeps) {
  async function initializeAuthSession() {
    const stored = await sessionRepository.load();
    if (!stored) return null;

    const expiresSoon =
      !stored.session.expiresAt ||
      stored.session.expiresAt - Date.now() < SESSION_REFRESH_MARGIN_MS;

    let current = stored;
    if (expiresSoon && stored.session.refreshToken) {
      const refreshed = await remoteRepository.refreshSession(
        stored.session.refreshToken,
      );
      if (!refreshed.success) {
        if (refreshed.terminal) {
          const cleared = await sessionRepository.saveIfCurrent(stored, null);
          return cleared ? null : sessionRepository.load();
        }
        return stored;
      }

      current = { ...stored, session: toSession(refreshed.session) };
      const persisted = await sessionRepository.saveIfCurrent(stored, current);
      if (!persisted) return sessionRepository.load();
    }

    const execution = await executeProtectedAuthRequest({
      stored: current,
      remoteRepository,
      sessionRepository,
      request: (accessToken) => remoteRepository.getCurrentUser(accessToken),
    });
    if (!execution.result.success) return execution.stored;

    const baseStored = execution.stored;
    if (!baseStored) return null;

    const nextStored: StoredAuthSession = {
      ...baseStored,
      user: execution.result.data,
    };
    const persisted = await sessionRepository.saveIfCurrent(
      baseStored,
      nextStored,
    );
    return persisted ? nextStored : sessionRepository.load();
  }

  function requestAuthOtp(email: string) {
    return remoteRepository.requestOtp(email);
  }

  /**
   * `shouldPersist` lets the caller refuse a verification that finished after
   * the app moved on (for example a logout), so it cannot start a session.
   */
  async function verifyAuthOtp(
    email: string,
    challengeId: string,
    code: string,
    shouldPersist: () => boolean = () => true,
  ) {
    const result = await remoteRepository.verifyOtp(email, challengeId, code);
    if (!result.success) {
      return {
        success: false as const,
        state: result.state,
        retryAfterSeconds: result.retryAfterSeconds,
        error: result.error,
        stored: undefined,
      };
    }
    if (!shouldPersist()) {
      return {
        success: false as const,
        state: "provider_error" as const,
        retryAfterSeconds: undefined,
        error: getOtpFailureMessage("provider_error"),
        stored: undefined,
      };
    }

    const stored = toStoredAuthSession(result.user, result.session);
    await sessionRepository.save(stored);
    // The write is queued behind other keystore operations, so the caller may
    // have moved on while it ran. Undo only THIS session: a newer login or a
    // rotated token has a different generation and is left alone.
    if (!shouldPersist()) {
      await discardSession(stored);
      return {
        success: false as const,
        state: "provider_error" as const,
        retryAfterSeconds: undefined,
        error: getOtpFailureMessage("provider_error"),
        stored: undefined,
      };
    }
    return { success: true as const, stored };
  }

  /** Clears the stored session only while it is still exactly `stored`. */
  function discardSession(stored: StoredAuthSession) {
    return sessionRepository.saveIfCurrent(stored, null);
  }

  function loadProfile(stored: StoredAuthSession) {
    return executeProtectedAuthRequest({
      stored,
      remoteRepository,
      sessionRepository,
      request: (accessToken) => remoteRepository.getProfile(accessToken),
    });
  }

  function saveProfile(
    stored: StoredAuthSession,
    payload: CustomerProfileUpdateRequest,
  ) {
    return executeProtectedAuthRequest({
      stored,
      remoteRepository,
      sessionRepository,
      request: (accessToken) =>
        remoteRepository.saveProfile(payload, accessToken),
    });
  }

  /** Local sign-out never depends on the network. */
  async function logoutAuth(stored: StoredAuthSession | null) {
    if (!stored) return;
    await sessionRepository.save(null);
    await remoteRepository
      .logout({
        accessToken: stored.session.accessToken,
        refreshToken: stored.session.refreshToken,
      })
      .catch(() => undefined);
  }

  return {
    initializeAuthSession,
    requestAuthOtp,
    verifyAuthOtp,
    discardSession,
    loadProfile,
    saveProfile,
    logoutAuth,
  };
}
