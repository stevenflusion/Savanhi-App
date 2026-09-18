import type {
  AuthPaymentMethod,
  AuthOnboardingDraft,
  AuthOnboardingStep,
  StoredAuthSession,
} from "../domain/auth.types";
import type { OtpAuthState } from "@repo/api-contracts";

export type AuthActionResult = {
  success: boolean;
  challengeId?: string;
  cooldownSeconds?: number;
  retryAfterSeconds?: number;
  state?: OtpAuthState;
  error?: string;
};

export type SaveProfileInput = {
  name: string;
  storeName: string;
};

export type SavePaymentMethodInput = {
  method: AuthPaymentMethod;
};

export type SaveLocationInput = {
  address: string;
  latitude: number;
  longitude: number;
};

export type VerifyOtpResult = AuthActionResult & {
  user?: StoredAuthSession["user"];
};

export type AuthContextType = {
  isLoggedIn: boolean;
  user: StoredAuthSession["user"] | null;
  onboardingDraft: AuthOnboardingDraft | null;
  onboardingStep: AuthOnboardingStep | null;
  isReady: boolean;
  logout: () => Promise<void>;
  saveProfile: (data: SaveProfileInput) => Promise<AuthActionResult>;
  savePhotos: (uris: string[]) => Promise<AuthActionResult>;
  savePaymentMethod: (
    data: SavePaymentMethodInput,
  ) => Promise<AuthActionResult>;
  saveLocation: (data: SaveLocationInput) => Promise<AuthActionResult>;
  setOnboardingStep: (step: AuthOnboardingStep) => Promise<AuthActionResult>;
  requestOTP: (email: string) => Promise<AuthActionResult>;
  verifyOTP: (
    email: string,
    challengeId: string,
    code: string,
  ) => Promise<VerifyOtpResult>;
  completeRegistration: () => Promise<AuthActionResult>;
};
