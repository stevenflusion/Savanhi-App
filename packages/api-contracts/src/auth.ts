export const AUTH_ROLES = [
  "admin",
  "marca",
  "client",
  "tendero",
  "delivery",
] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

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
};

export type OtpVerifyResponse = AuthResponse & {
  isNewUser: boolean;
};

export type UpdateProfileRequest = {
  fullName: string;
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
