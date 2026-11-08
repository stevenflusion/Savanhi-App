import type { AuthSession, AuthUser } from "@repo/api-contracts";

import type {
  AuthSessionState,
  StoredAuthSession,
} from "../domain/auth.types";

export const SESSION_REFRESH_MARGIN_MS = 60_000;

export function toSession(session: AuthSession): AuthSessionState {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresIn ? Date.now() + session.expiresIn * 1000 : null,
  };
}

export function toStoredAuthSession(
  user: AuthUser,
  session: AuthSession,
): StoredAuthSession {
  return { user, session: toSession(session) };
}
