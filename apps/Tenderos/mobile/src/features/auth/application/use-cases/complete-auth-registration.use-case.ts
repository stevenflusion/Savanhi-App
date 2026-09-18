import type { AuthUser } from "@repo/api-contracts";

import type { AuthRemoteRepository } from "../ports/auth-remote-repository";
import type { AuthSessionRepository } from "../ports/auth-session-repository";
import type { StoredAuthSession } from "../../domain/auth.types";
import { executeProtectedAuthRequest } from "./execute-protected-auth-request";

type CompleteAuthRegistrationDeps = {
  remoteRepository: AuthRemoteRepository;
  sessionRepository: AuthSessionRepository;
};

export function createCompleteAuthRegistrationUseCase({
  remoteRepository,
  sessionRepository,
}: CompleteAuthRegistrationDeps) {
  return async function completeAuthRegistration(
    stored: StoredAuthSession | null,
  ) {
    if (!stored) {
      return { success: false, error: "Sesión no encontrada." };
    }

    const execution = await executeProtectedAuthRequest({
      stored,
      remoteRepository,
      sessionRepository,
      request: (accessToken) =>
        remoteRepository.completeRegistration({
          user: stored.user,
          onboardingDraft: stored.onboardingDraft,
          accessToken,
        }),
    });
    const result = execution.result;

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        stored: execution.stored,
      };
    }

    const baseStored = execution.stored;
    if (!baseStored) {
      return {
        success: false,
        error: "La sesión cambió. Intenta nuevamente.",
        stored: null,
      };
    }

    const nextUser = result.data.user satisfies AuthUser;

    const nextStored = {
      ...baseStored,
      user: nextUser,
      onboardingDraft: null,
      onboardingStep: null,
    } satisfies StoredAuthSession;

    const persisted = await sessionRepository.saveIfCurrent(
      baseStored,
      nextStored,
    );
    if (!persisted) {
      return {
        success: false,
        error: "La sesión cambió. Intenta nuevamente.",
        stored: await sessionRepository.load(),
      };
    }

    return {
      success: true,
      user: nextUser,
      onboardingDraft: null,
      stored: nextStored,
      data: result.data,
    };
  };
}
