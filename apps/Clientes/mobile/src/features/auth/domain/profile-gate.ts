import type { AuthUser, CustomerProfile } from "@repo/api-contracts";

/** What the app knows about the customer's server-side profile. */
export type ProfileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "forbidden" }
  | { status: "loaded"; profile: CustomerProfile };

export type GateState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "wrong-role" }
  | { status: "profile-error" }
  | {
      status: "profile-required";
      needsName: boolean;
      underage: boolean;
      birthDate: string | null;
    }
  | { status: "ready" };

export type GateArea = "tabs" | "auth";

export const SIGNED_OUT_PATHS = [
  "/auth/welcome",
  "/auth/enter-email",
  "/auth/enter-otp",
];

export function hasName(fullName: string) {
  return fullName.trim().length > 0;
}

/** The new name and the optional surname become the one existing `fullName`. */
export function composeFullName(name: string, surname: string) {
  const trimmedName = name.trim();
  if (!trimmedName) return "";
  const trimmedSurname = surname.trim();
  return trimmedSurname ? `${trimmedName} ${trimmedSurname}` : trimmedName;
}

/**
 * The customer API is open only for a server-eligible customer that also has a
 * name. `registrationStatus` is deliberately not read: it says how far
 * onboarding went, not whether the person is an adult (C9).
 */
export function deriveGate(input: {
  isReady: boolean;
  user: Pick<AuthUser, "role"> | null;
  profileState: ProfileState;
}): GateState {
  const { isReady, user, profileState } = input;
  if (!isReady) return { status: "loading" };
  if (!user) return { status: "signed-out" };
  if (user.role !== "client") return { status: "wrong-role" };

  switch (profileState.status) {
    case "forbidden":
      return { status: "wrong-role" };
    case "idle":
    case "loading":
      return { status: "loading" };
    case "error":
      return { status: "profile-error" };
    case "loaded": {
      const { fullName, birthDate, eligibility } = profileState.profile;
      const named = hasName(fullName);
      if (eligibility === "eligible" && named) return { status: "ready" };
      return {
        status: "profile-required",
        needsName: !named,
        underage: eligibility === "underage",
        birthDate,
      };
    }
  }
}

/** The redirect an area must perform for a gate state, or null to stay. */
export function getGateRedirect(
  area: GateArea,
  gate: GateState,
  pathname: string,
): string | null {
  if (gate.status === "loading") return null;

  if (area === "tabs") {
    if (gate.status === "ready") return null;
    return gate.status === "signed-out" ? "/auth/welcome" : "/auth/profile";
  }

  if (gate.status === "ready") return "/";
  if (gate.status === "signed-out") {
    return SIGNED_OUT_PATHS.includes(pathname) ? null : "/auth/welcome";
  }
  return pathname === "/auth/profile" ? null : "/auth/profile";
}
