import type { AuthRemoteRepository } from "../ports/auth-remote-repository";
import type { AuthSessionRepository } from "../ports/auth-session-repository";
import type { StoredAuthSession } from "../../domain/auth.types";

import { normalizeOnboardingStep } from "../../domain/auth-navigation";
import { executeProtectedAuthRequest } from "./execute-protected-auth-request";

type UpdateAuthProfileDeps = {
  remoteRepository: AuthRemoteRepository;
  sessionRepository: AuthSessionRepository;
};

export function createUpdateAuthProfileUseCase({
  remoteRepository,
  sessionRepository,
}: UpdateAuthProfileDeps) {
  return async function updateAuthProfile(
    stored: StoredAuthSession | null,
    input: { name: string; storeName: string },
  ) {
    if (!stored) {
      return { success: false as const, error: "Sesión no encontrada." };
    }

    const execution = await executeProtectedAuthRequest({
      stored,
      remoteRepository,
      sessionRepository,
      request: (accessToken) =>
        remoteRepository.updateProfile({ fullName: input.name }, accessToken),
    });
    if (!execution.result.success) {
      return {
        success: false as const,
        error: execution.result.error,
        stored: execution.stored,
      };
    }

    const baseStored = execution.stored;
    if (!baseStored) {
      return {
        success: false as const,
        error: "La sesión cambió. Intenta nuevamente.",
        stored: null,
      };
    }

    const onboardingDraft = {
      ...(baseStored.onboardingDraft ?? {}),
      ...(input.storeName.trim() ? { storeName: input.storeName.trim() } : {}),
    };
    const nextStored = {
      ...baseStored,
      user: execution.result.data,
      onboardingDraft,
      onboardingStep:
        stored.user.registrationStatus === "profile_required"
          ? "store-name"
          : input.storeName.trim()
            ? "location-permissions"
            : normalizeOnboardingStep(
                execution.result.data,
                onboardingDraft,
                baseStored.onboardingStep,
              ),
    } satisfies StoredAuthSession;
    const persisted = await sessionRepository.saveIfCurrent(
      baseStored,
      nextStored,
    );
    if (!persisted) {
      return {
        success: false as const,
        error: "La sesión cambió. Intenta nuevamente.",
        stored: await sessionRepository.load(),
      };
    }
    return { success: true as const, stored: nextStored };
  };
}
