import type { AuthUser } from "@repo/api-contracts";

export type AuthPaymentMethod = "efectivo" | "pichincha";

export const AUTH_ONBOARDING_STEPS = [
  "person-name",
  "store-name",
  "location-permissions",
  "business-location",
  "store-photos",
  "account-created",
] as const;

export type AuthOnboardingStep = (typeof AUTH_ONBOARDING_STEPS)[number];

export type AuthOnboardingDraft = {
  storeName?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  photos?: string[];
  paymentMethod?: AuthPaymentMethod;
};

export type AuthSessionState = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
};

export type StoredAuthSession = {
  user: AuthUser;
  session: AuthSessionState;
  onboardingDraft: AuthOnboardingDraft | null;
  onboardingStep: AuthOnboardingStep | null;
};

export type LegacyStoredAuthSession = {
  user: AuthUser & AuthOnboardingDraft;
  session: AuthSessionState;
};
