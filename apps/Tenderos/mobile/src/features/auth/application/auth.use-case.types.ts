import type { AuthUser, OtpAuthState } from "@repo/api-contracts";

import type { AuthCompletionResult } from "./ports/auth-remote-repository";
import type { StoredAuthSession } from "../domain/auth.types";

export type AuthRequestResult = {
  success: boolean;
  challengeId?: string;
  cooldownSeconds?: number;
  retryAfterSeconds?: number;
  state?: OtpAuthState;
  error?: string;
};

export type VerifyAuthOtpResult = AuthRequestResult & {
  stored?: StoredAuthSession;
};

export type CompleteAuthRegistrationResult = AuthRequestResult & {
  user?: AuthUser;
  onboardingDraft?: null;
  stored?: StoredAuthSession | null;
  data?: AuthCompletionResult;
};

export type AuthUseCases = {
  initializeAuthSession: () => Promise<StoredAuthSession | null>;
  persistAuthSession: (stored: StoredAuthSession | null) => Promise<void>;
  requestAuthOtp: (email: string) => Promise<AuthRequestResult>;
  verifyAuthOtp: (
    email: string,
    challengeId: string,
    code: string,
  ) => Promise<VerifyAuthOtpResult>;
  updateAuthProfile: (
    stored: StoredAuthSession | null,
    input: { name: string; storeName: string },
  ) => Promise<AuthRequestResult & { stored?: StoredAuthSession | null }>;
  completeAuthRegistration: (
    stored: StoredAuthSession | null,
  ) => Promise<CompleteAuthRegistrationResult>;
  logoutAuth: (stored: StoredAuthSession | null) => Promise<void>;
};
