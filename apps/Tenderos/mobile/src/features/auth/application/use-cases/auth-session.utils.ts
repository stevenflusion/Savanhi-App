import type { AuthSession, AuthUser } from "@repo/api-contracts";

import type {
  AuthOnboardingDraft,
  AuthOnboardingStep,
  AuthSessionState,
  StoredAuthSession,
} from "../../domain/auth.types";

export const SESSION_REFRESH_MARGIN_MS = 60_000;

export function toSession(session: AuthSession): AuthSessionState {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresIn ? Date.now() + session.expiresIn * 1000 : null,
  };
}

export function toStoredAuthSession(user: AuthUser, session: AuthSession) {
  return {
    user,
    session: toSession(session),
    onboardingDraft: null,
    onboardingStep:
      user.registrationStatus === "profile_required"
        ? "person-name"
        : user.registrationStatus === "store_required"
          ? "store-name"
          : null,
  } satisfies StoredAuthSession;
}

export function withOnboardingDraft(
  stored: StoredAuthSession,
  onboardingDraft: AuthOnboardingDraft | null,
) {
  return {
    ...stored,
    onboardingDraft,
  } satisfies StoredAuthSession;
}

export function withOnboardingStep(
  stored: StoredAuthSession,
  onboardingStep: AuthOnboardingStep | null,
) {
  return {
    ...stored,
    onboardingStep,
  } satisfies StoredAuthSession;
}
