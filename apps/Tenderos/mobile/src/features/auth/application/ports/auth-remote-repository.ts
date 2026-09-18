import type {
  AuthSession,
  AuthUser,
  OtpAuthState,
  UpdateProfileRequest,
} from "@repo/api-contracts";
import type { OtpFailureState } from "../otp-flow";

import type {
  AuthOnboardingDraft,
  AuthPaymentMethod,
} from "../../domain/auth.types";

export type AuthCompletionPayload = {
  user: AuthUser;
  onboardingDraft: AuthOnboardingDraft | null;
  accessToken: string;
};

export type AuthCompletionResult = {
  user: AuthUser;
  storeId: string;
};

export type AuthRemoteResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      status?: number;
      unauthorized: boolean;
    };

export type RefreshSessionResult =
  | { success: true; session: AuthSession }
  | {
      success: false;
      error: string;
      status?: number;
      terminal: boolean;
    };

export type OtpRequestRemoteResult =
  | {
      success: true;
      state: Extract<OtpAuthState, "sent">;
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
  | {
      success: true;
      user: AuthUser;
      session: AuthSession;
    }
  | {
      success: false;
      state: OtpFailureState;
      retryAfterSeconds?: number;
      error: string;
    };

export type AuthRemoteRepository = {
  refreshSession: (refreshToken: string) => Promise<RefreshSessionResult>;
  getCurrentUser: (accessToken: string) => Promise<AuthRemoteResult<AuthUser>>;
  updateProfile: (
    payload: UpdateProfileRequest,
    accessToken: string,
  ) => Promise<AuthRemoteResult<AuthUser>>;
  requestOtp: (email: string) => Promise<OtpRequestRemoteResult>;
  verifyOtp: (
    email: string,
    challengeId: string,
    code: string,
  ) => Promise<OtpVerifyRemoteResult>;
  completeRegistration: (
    payload: AuthCompletionPayload,
  ) => Promise<AuthRemoteResult<AuthCompletionResult>>;
  logout: (input: {
    accessToken: string;
    refreshToken: string | null;
  }) => Promise<void>;
};

export type AuthStorePayload = {
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  paymentMethod?: AuthPaymentMethod;
};
