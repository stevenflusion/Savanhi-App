// `marca` is retained so stored roles are never remapped: `normalizeRole`
// falls back to `tendero`, so dropping it would promote an existing marca user.
// It is frozen and out of MVP scope per S12 — no route grants it.
export const AUTH_ROLES = [
  "admin",
  "marca",
  "client",
  "tendero",
  "delivery",
] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

/**
 * The roles an app may ask for when its OWN registration creates the account
 * (C1: “Cada app indica su rol”). Deliberately NOT `AuthRole`: `admin`,
 * `marca` and `delivery` are stored values no app registers into, and a
 * registration payload that could name them would be a privilege path.
 *
 * The indication applies at account creation and nowhere else, which is why
 * the field that carries it is called `registrationRole`.
 */
export const REGISTRATION_ROLES = ["client", "tendero"] as const;

export type RegistrationRole = (typeof REGISTRATION_ROLES)[number];

export const REGISTRATION_STATUSES = [
  "profile_required",
  "store_required",
  "completed",
] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: AuthRole;
  active: boolean;
  emailVerifiedAt: string | null;
  registrationStatus: RegistrationStatus;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
};

export type RefreshRequest = {
  refreshToken: string;
};

export type AuthResponse = {
  user: AuthUser;
  session: AuthSession;
};

export type OtpRequestRequest = {
  email: string;
};

export type OtpRequestResponse = {
  ok: true;
  challengeId: string;
  cooldownSeconds: number;
};

export const OTP_AUTH_STATES = [
  "sending",
  "sent",
  "incorrect_code",
  "expired_code",
  "rate_limited",
  "offline",
  "provider_error",
] as const;

export type OtpAuthState = (typeof OTP_AUTH_STATES)[number];

export type OtpAuthErrorCode = Exclude<
  OtpAuthState,
  "sending" | "sent" | "offline"
>;

export type AuthErrorResponse = {
  error: string;
  code?: OtpAuthErrorCode;
  details?: {
    retryAfterSeconds?: number;
    [key: string]: unknown;
  };
};

export type OtpVerifyRequest = {
  email: string;
  challengeId: string;
  token: string;
  /**
   * Which app is verifying (C1). Optional: absent means the backend process's
   * own default. It is read ONLY when this verification creates the account —
   * an existing account always keeps its stored role.
   */
  registrationRole?: RegistrationRole;
};

export type OtpVerifyResponse = AuthResponse & {
  isNewUser: boolean;
};

export type UpdateProfileRequest = {
  fullName: string;
};

/**
 * The customer app is for adults (C9): a customer must be at least this old,
 * counted in completed years on the `America/Bogota` calendar day, so the 18th
 * birthday itself already qualifies.
 */
export const CUSTOMER_MINIMUM_AGE = 18;

/**
 * Whether a customer may use the customer API. Decided from the stored birth
 * date alone, so it is the same fact for a new account and for one that
 * existed before the rule (C9, no grandfathering). `registrationStatus` is
 * deliberately not part of it: the status says how far onboarding went, not
 * how old the person is.
 */
export const CUSTOMER_ELIGIBILITIES = [
  "eligible",
  "birth_date_required",
  "underage",
] as const;

export type CustomerEligibility = (typeof CUSTOMER_ELIGIBILITIES)[number];

/**
 * The customer's own profile. It is a separate resource from `AuthUser` on
 * purpose: the tendero's auth responses must not grow a key, so the birth date
 * is only ever read here. `birthDate` is a date-only `YYYY-MM-DD` string (S11).
 */
export type CustomerProfile = {
  fullName: string;
  birthDate: string | null;
  eligibility: CustomerEligibility;
};

export type CustomerProfileUpdateRequest = {
  fullName: string;
  birthDate: string;
};

export type CompleteRegistrationRequest = {
  fullName: string;
  store: {
    name: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    paymentMethod?: "efectivo" | "pichincha";
  };
};

export type CompleteRegistrationResponse = {
  user: AuthUser;
  storeId: string;
};
