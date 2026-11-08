import type { AuthUser } from "@repo/api-contracts";

export type AuthSessionState = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
};

export type StoredAuthSession = {
  user: AuthUser;
  session: AuthSessionState;
};
