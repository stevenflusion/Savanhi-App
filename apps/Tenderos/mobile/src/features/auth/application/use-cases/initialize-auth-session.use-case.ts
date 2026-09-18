import type { AuthRemoteRepository } from "../ports/auth-remote-repository";
import type { AuthSessionRepository } from "../ports/auth-session-repository";

import { SESSION_REFRESH_MARGIN_MS, toSession } from "./auth-session.utils";
import { normalizeOnboardingStep } from "../../domain/auth-navigation";
import { executeProtectedAuthRequest } from "./execute-protected-auth-request";

type InitializeAuthSessionDeps = {
  remoteRepository: AuthRemoteRepository;
  sessionRepository: AuthSessionRepository;
};

export function createInitializeAuthSessionUseCase({
  remoteRepository,
  sessionRepository,
}: InitializeAuthSessionDeps) {
  return async function initializeAuthSession() {
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

      current = {
        ...stored,
        session: toSession(refreshed.session),
      };
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

    const nextStored = {
      ...baseStored,
      user: execution.result.data,
      onboardingStep: normalizeOnboardingStep(
        execution.result.data,
        baseStored.onboardingDraft,
        baseStored.onboardingStep,
      ),
    };
    const persisted = await sessionRepository.saveIfCurrent(
      baseStored,
      nextStored,
    );
    return persisted ? nextStored : sessionRepository.load();
  };
}
