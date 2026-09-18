import type { AuthUser } from "@repo/api-contracts";

import {
  AUTH_ONBOARDING_STEPS,
  type AuthOnboardingDraft,
  type AuthOnboardingStep,
} from "./auth.types";

export const ONBOARDING_PATHS = new Set([
  ...AUTH_ONBOARDING_STEPS.map((step) => `/auth/${step}`),
  "/auth/payment-method",
  "/auth/access-notify",
  "/auth/search-location",
]);

function hasStoreName(draft: AuthOnboardingDraft | null) {
  return Boolean(draft?.storeName?.trim());
}

function hasLocation(draft: AuthOnboardingDraft | null) {
  return Boolean(
    draft?.address?.trim() &&
    Number.isFinite(draft.latitude) &&
    Number.isFinite(draft.longitude),
  );
}

export function deriveOnboardingStep(
  draft: AuthOnboardingDraft | null,
): AuthOnboardingStep {
  if (!hasStoreName(draft)) return "store-name";
  if (!hasLocation(draft)) return "location-permissions";
  if (!draft?.photos) return "store-photos";
  return "account-created";
}

export function normalizeOnboardingStep(
  user: AuthUser,
  draft: AuthOnboardingDraft | null,
  step: unknown,
): AuthOnboardingStep | null {
  if (user.registrationStatus === "completed") return null;
  if (user.registrationStatus === "profile_required") return "person-name";

  if (!AUTH_ONBOARDING_STEPS.includes(step as AuthOnboardingStep)) {
    return deriveOnboardingStep(draft);
  }

  const candidate = step as AuthOnboardingStep;
  if (candidate === "person-name") return deriveOnboardingStep(draft);
  if (
    [
      "location-permissions",
      "business-location",
      "store-photos",
      "account-created",
    ].includes(candidate) &&
    !hasStoreName(draft)
  ) {
    return "store-name";
  }
  if (
    ["store-photos", "account-created"].includes(candidate) &&
    !hasLocation(draft)
  ) {
    return "location-permissions";
  }
  if (candidate === "account-created" && !draft?.photos) {
    return "store-photos";
  }
  return candidate;
}

export function getCanonicalAuthPath(
  user: AuthUser | null,
  draft: AuthOnboardingDraft | null,
  step: AuthOnboardingStep | null,
) {
  if (!user) return "/auth/welcome";
  if (user.registrationStatus === "completed") return "/(tabs)";
  const normalizedStep = normalizeOnboardingStep(user, draft, step);
  return `/auth/${normalizedStep ?? "person-name"}`;
}

export function getAuthLayoutRedirect(
  pathname: string,
  user: AuthUser | null,
  draft: AuthOnboardingDraft | null,
  step: AuthOnboardingStep | null,
) {
  if (!user) {
    return ONBOARDING_PATHS.has(pathname) ? "/auth/welcome" : null;
  }

  const canonicalPath = getCanonicalAuthPath(user, draft, step);
  const isBusinessLocationSubstep =
    canonicalPath === "/auth/business-location" &&
    pathname === "/auth/search-location";

  return pathname === canonicalPath || isBusinessLocationSubstep
    ? null
    : canonicalPath;
}

export function getTabsLayoutRedirect(
  user: AuthUser | null,
  draft: AuthOnboardingDraft | null,
  step: AuthOnboardingStep | null,
) {
  const canonicalPath = getCanonicalAuthPath(user, draft, step);
  return canonicalPath === "/(tabs)" ? null : canonicalPath;
}
