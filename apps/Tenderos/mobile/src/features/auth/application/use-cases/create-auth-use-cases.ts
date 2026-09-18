import type { AuthUseCases } from "../auth.use-case.types";
import type { AuthRemoteRepository } from "../ports/auth-remote-repository";
import type { AuthSessionRepository } from "../ports/auth-session-repository";

import { createCompleteAuthRegistrationUseCase } from "./complete-auth-registration.use-case";
import { createInitializeAuthSessionUseCase } from "./initialize-auth-session.use-case";
import { createLogoutAuthUseCase } from "./logout-auth.use-case";
import { createPersistAuthSessionUseCase } from "./persist-auth-session.use-case";
import { createRequestAuthOtpUseCase } from "./request-auth-otp.use-case";
import { createVerifyAuthOtpUseCase } from "./verify-auth-otp.use-case";
import { createUpdateAuthProfileUseCase } from "./update-auth-profile.use-case";

type CreateAuthUseCasesDeps = {
  remoteRepository: AuthRemoteRepository;
  sessionRepository: AuthSessionRepository;
};

export function createAuthUseCases({
  remoteRepository,
  sessionRepository,
}: CreateAuthUseCasesDeps): AuthUseCases {
  return {
    initializeAuthSession: createInitializeAuthSessionUseCase({
      remoteRepository,
      sessionRepository,
    }),
    persistAuthSession: createPersistAuthSessionUseCase(sessionRepository),
    requestAuthOtp: createRequestAuthOtpUseCase(remoteRepository),
    verifyAuthOtp: createVerifyAuthOtpUseCase({
      remoteRepository,
      sessionRepository,
    }),
    updateAuthProfile: createUpdateAuthProfileUseCase({
      remoteRepository,
      sessionRepository,
    }),
    completeAuthRegistration: createCompleteAuthRegistrationUseCase({
      remoteRepository,
      sessionRepository,
    }),
    logoutAuth: createLogoutAuthUseCase({
      remoteRepository,
      sessionRepository,
    }),
  };
}
