import type { AuthRemoteRepository } from "../ports/auth-remote-repository";
import type { AuthSessionRepository } from "../ports/auth-session-repository";

import { toStoredAuthSession } from "./auth-session.utils";

type VerifyAuthOtpDeps = {
  remoteRepository: AuthRemoteRepository;
  sessionRepository: AuthSessionRepository;
};

export function createVerifyAuthOtpUseCase({
  remoteRepository,
  sessionRepository,
}: VerifyAuthOtpDeps) {
  return async function verifyAuthOtp(
    email: string,
    challengeId: string,
    code: string,
  ) {
    const result = await remoteRepository.verifyOtp(email, challengeId, code);
    if (!result.success) {
      return {
        success: false,
        state: result.state,
        retryAfterSeconds: result.retryAfterSeconds,
        error: result.error,
      };
    }

    const stored = toStoredAuthSession(result.user, result.session);
    await sessionRepository.save(stored);

    return {
      success: true,
      stored,
    };
  };
}
