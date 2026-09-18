import type {
  AuthRemoteRepository,
  AuthRemoteResult,
} from "../ports/auth-remote-repository";
import type { AuthSessionRepository } from "../ports/auth-session-repository";
import type { StoredAuthSession } from "../../domain/auth.types";

import { toSession } from "./auth-session.utils";

type ExecuteProtectedAuthRequestDeps<T> = {
  stored: StoredAuthSession;
  remoteRepository: AuthRemoteRepository;
  sessionRepository: AuthSessionRepository;
  request: (accessToken: string) => Promise<AuthRemoteResult<T>>;
};

function isSameIdentity(
  current: StoredAuthSession | null,
  expected: StoredAuthSession,
): current is StoredAuthSession {
  return current?.user.id === expected.user.id;
}

function isSameGeneration(
  current: StoredAuthSession | null,
  expected: StoredAuthSession,
) {
  return (
    isSameIdentity(current, expected) &&
    current?.session.accessToken === expected.session.accessToken &&
    current.session.refreshToken === expected.session.refreshToken
  );
}

export async function executeProtectedAuthRequest<T>({
  stored,
  remoteRepository,
  sessionRepository,
  request,
}: ExecuteProtectedAuthRequestDeps<T>) {
  const firstResult = await request(stored.session.accessToken);
  if (firstResult.success || !firstResult.unauthorized) {
    return { result: firstResult, stored };
  }

  if (!stored.session.refreshToken) {
    return { result: firstResult, stored };
  }

  let current = await sessionRepository.load();
  if (!isSameIdentity(current, stored)) {
    return { result: firstResult, stored: current };
  }

  const retryWithCurrentSession = async (latest: StoredAuthSession) => {
    const retryResult = await request(latest.session.accessToken);
    const persisted = await sessionRepository.load();
    if (!isSameGeneration(persisted, latest)) {
      return { result: firstResult, stored: persisted };
    }
    return { result: retryResult, stored: persisted };
  };

  if (!isSameGeneration(current, stored)) {
    return retryWithCurrentSession(current);
  }

  const refresh = await remoteRepository.refreshSession(
    current.session.refreshToken!,
  );
  if (!refresh.success) {
    if (refresh.terminal) {
      const cleared = await sessionRepository.saveIfCurrent(current, null);
      current = cleared ? null : await sessionRepository.load();
    }
    return {
      result: {
        success: false as const,
        error: refresh.error,
        status: refresh.status,
        unauthorized: true,
      },
      stored: current,
    };
  }

  const persistedBeforeRotation = await sessionRepository.load();
  if (!isSameIdentity(persistedBeforeRotation, current)) {
    return { result: firstResult, stored: persistedBeforeRotation };
  }
  if (!isSameGeneration(persistedBeforeRotation, current)) {
    return retryWithCurrentSession(persistedBeforeRotation);
  }

  const rotatedStored = {
    ...persistedBeforeRotation,
    session: toSession(refresh.session),
  } satisfies StoredAuthSession;
  const persisted = await sessionRepository.saveIfCurrent(
    persistedBeforeRotation,
    rotatedStored,
  );
  if (!persisted) {
    const latest = await sessionRepository.load();
    if (!isSameIdentity(latest, persistedBeforeRotation)) {
      return { result: firstResult, stored: latest };
    }
    return retryWithCurrentSession(latest);
  }

  return retryWithCurrentSession(rotatedStored);
}
