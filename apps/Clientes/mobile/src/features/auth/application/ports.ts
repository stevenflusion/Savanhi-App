import type {
  AuthSession,
  AuthUser,
  CustomerEligibility,
  CustomerProfile,
  CustomerProfileUpdateRequest,
} from "@repo/api-contracts";

import type { OtpFailureState } from "./otp-flow";
import type { StoredAuthSession } from "../domain/auth.types";

export type AuthRemoteResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      status?: number;
      unauthorized: boolean;
      /** The server's eligibility code, when it sent one (never its text). */
      eligibility?: CustomerEligibility;
    };

export type RefreshSessionResult =
  | { success: true; session: AuthSession }
  | { success: false; error: string; status?: number; terminal: boolean };

export type OtpRequestRemoteResult =
  | {
      success: true;
      state: "sent";
      challengeId: string;
      cooldownSeconds: number;
    }
  | {
      success: false;
      state: OtpFailureState;
      retryAfterSeconds?: number;
      error: string;
    };

export type OtpVerifyRemoteResult =
  | { success: true; user: AuthUser; session: AuthSession }
  | {
      success: false;
      state: OtpFailureState;
      retryAfterSeconds?: number;
      error: string;
    };

export type AuthRemoteRepository = {
  refreshSession: (refreshToken: string) => Promise<RefreshSessionResult>;
  getCurrentUser: (accessToken: string) => Promise<AuthRemoteResult<AuthUser>>;
  requestOtp: (email: string) => Promise<OtpRequestRemoteResult>;
  verifyOtp: (
    email: string,
    challengeId: string,
    code: string,
  ) => Promise<OtpVerifyRemoteResult>;
  getProfile: (
    accessToken: string,
  ) => Promise<AuthRemoteResult<CustomerProfile>>;
  saveProfile: (
    payload: CustomerProfileUpdateRequest,
    accessToken: string,
  ) => Promise<AuthRemoteResult<CustomerProfile>>;
  logout: (input: {
    accessToken: string;
    refreshToken: string | null;
  }) => Promise<void>;
};

export type AuthSessionRepository = {
  load: () => Promise<StoredAuthSession | null>;
  save: (value: StoredAuthSession | null) => Promise<void>;
  saveIfCurrent: (
    expected: StoredAuthSession,
    value: StoredAuthSession | null,
  ) => Promise<boolean>;
};
