import type { CustomerProfile } from "@repo/api-contracts";

import {
  composeFullName,
  deriveGate,
  getGateRedirect,
  hasName,
  type GateState,
  type ProfileState,
} from "@/src/features/auth/domain/profile-gate";

const client = { role: "client" as const };

const loaded = (profile: Partial<CustomerProfile>): ProfileState => ({
  status: "loaded",
  profile: {
    fullName: "",
    birthDate: null,
    eligibility: "birth_date_required",
    ...profile,
  },
});

const gate = (
  overrides: Partial<Parameters<typeof deriveGate>[0]> = {},
): GateState =>
  deriveGate({
    isReady: true,
    user: client,
    profileState: loaded({
      fullName: "Camila Vega",
      birthDate: "2002-11-04",
      eligibility: "eligible",
    }),
    ...overrides,
  });

describe("name handling (C8)", () => {
  it("composes the name and an optional surname into one fullName", () => {
    expect(composeFullName("Camila", "Vega")).toBe("Camila Vega");
    expect(composeFullName("  Camila ", "  Vega  ")).toBe("Camila Vega");
    expect(composeFullName("Camila", "")).toBe("Camila");
    expect(composeFullName("Camila", "   ")).toBe("Camila");
  });

  it("composes nothing when the name is blank", () => {
    expect(composeFullName("", "Vega")).toBe("");
    expect(composeFullName("   ", "")).toBe("");
  });

  it("treats whitespace-only text as no name", () => {
    expect(hasName("")).toBe(false);
    expect(hasName(" \n\t ")).toBe(false);
    expect(hasName("María del Carmen")).toBe(true);
  });
});

describe("gate state (C9)", () => {
  it("holds while the session is being restored", () => {
    expect(gate({ isReady: false, user: null })).toEqual({ status: "loading" });
  });

  it("is signed out without a session", () => {
    expect(gate({ user: null })).toEqual({ status: "signed-out" });
  });

  it("ends in the wrong-role dead end for any non-client account", () => {
    for (const role of ["tendero", "admin", "marca", "delivery"] as const) {
      expect(gate({ user: { role } })).toEqual({ status: "wrong-role" });
    }
    expect(gate({ profileState: { status: "forbidden" } })).toEqual({
      status: "wrong-role",
    });
  });

  it("holds while the profile loads and reports a failed load", () => {
    expect(gate({ profileState: { status: "idle" } })).toEqual({
      status: "loading",
    });
    expect(gate({ profileState: { status: "loading" } })).toEqual({
      status: "loading",
    });
    expect(gate({ profileState: { status: "error" } })).toEqual({
      status: "profile-error",
    });
  });

  it("opens only for an eligible customer that also has a name", () => {
    expect(gate()).toEqual({ status: "ready" });
  });

  it("asks for the name when an eligible customer has none, keeping the date", () => {
    expect(
      gate({
        profileState: loaded({
          fullName: "  ",
          birthDate: "2002-11-04",
          eligibility: "eligible",
        }),
      }),
    ).toEqual({
      status: "profile-required",
      needsName: true,
      underage: false,
      birthDate: "2002-11-04",
    });
  });

  it("asks only for the birth date when a name is already saved", () => {
    expect(
      gate({
        profileState: loaded({ fullName: "María del Carmen Pérez" }),
      }),
    ).toEqual({
      status: "profile-required",
      needsName: false,
      underage: false,
      birthDate: null,
    });
  });

  it("flags an underage profile read, with or without a name", () => {
    expect(
      gate({
        profileState: loaded({
          fullName: "Camila Vega",
          birthDate: "2012-01-01",
          eligibility: "underage",
        }),
      }),
    ).toEqual({
      status: "profile-required",
      needsName: false,
      underage: true,
      birthDate: "2012-01-01",
    });
    expect(
      gate({
        profileState: loaded({
          fullName: "",
          birthDate: "2012-01-01",
          eligibility: "underage",
        }),
      }),
    ).toMatchObject({ needsName: true, underage: true });
  });

  it("never reads registrationStatus: a name alone does not open the app", () => {
    const user = { role: "client" as const, registrationStatus: "completed" };
    expect(
      gate({
        user,
        profileState: loaded({ fullName: "Camila Vega" }),
      }),
    ).toMatchObject({ status: "profile-required" });
  });
});

describe("gate redirects", () => {
  const states = {
    loading: { status: "loading" },
    signedOut: { status: "signed-out" },
    wrongRole: { status: "wrong-role" },
    error: { status: "profile-error" },
    required: {
      status: "profile-required",
      needsName: true,
      underage: false,
      birthDate: null,
    },
    ready: { status: "ready" },
  } satisfies Record<string, GateState>;

  it("never redirects while loading, so nothing flashes", () => {
    expect(getGateRedirect("tabs", states.loading, "/")).toBeNull();
    expect(getGateRedirect("auth", states.loading, "/auth/welcome")).toBeNull();
  });

  it("keeps every tab closed until the gate is ready", () => {
    expect(getGateRedirect("tabs", states.signedOut, "/")).toBe(
      "/auth/welcome",
    );
    for (const key of ["wrongRole", "error", "required"] as const) {
      expect(getGateRedirect("tabs", states[key], "/map")).toBe(
        "/auth/profile",
      );
    }
    expect(getGateRedirect("tabs", states.ready, "/")).toBeNull();
  });

  it("sends a signed-in customer out of the welcome flow, without a loop", () => {
    expect(getGateRedirect("auth", states.ready, "/auth/welcome")).toBe("/");
    for (const key of ["wrongRole", "error", "required"] as const) {
      expect(getGateRedirect("auth", states[key], "/auth/welcome")).toBe(
        "/auth/profile",
      );
      expect(getGateRedirect("auth", states[key], "/auth/profile")).toBeNull();
    }
  });

  it("keeps a signed-out visitor inside the welcome flow only", () => {
    for (const path of [
      "/auth/welcome",
      "/auth/enter-email",
      "/auth/enter-otp",
    ]) {
      expect(getGateRedirect("auth", states.signedOut, path)).toBeNull();
    }
    expect(getGateRedirect("auth", states.signedOut, "/auth/profile")).toBe(
      "/auth/welcome",
    );
  });
});
