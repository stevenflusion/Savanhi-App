import React from "react";
import { Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

import AuthLayout from "@/app/auth/_layout";
import TabsLayout from "@/app/(tabs)/_layout";
import { AuthProvider } from "@/src/features/auth/presentation/AuthProvider";
import { AuthGuard } from "@/src/features/auth/presentation/AuthGuard";
import { CLIENT_SESSION_STORAGE_KEY } from "@/src/features/auth/infrastructure/session-storage";

let mockPathname = "/";

jest.mock("expo-router", () => {
  const { Text, View } = jest.requireActual("react-native");
  const Tabs = Object.assign(
    () => <Text>tabs-visible</Text>,
    { Screen: () => null },
  );
  return {
    Tabs,
    Stack: () => <Text>auth-stack</Text>,
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
    usePathname: () => mockPathname,
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const backing = (SecureStore as unknown as { __store: Map<string, string> })
  .__store;

type FakeResponse = {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
};
const reply = (status: number, body: unknown): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
});

const routes = new Map<string, () => FakeResponse | Promise<FakeResponse>>();
const fetchMock = jest.fn();

const eligibleProfile = {
  fullName: "Camila Vega",
  birthDate: "2002-11-04",
  eligibility: "eligible",
};

function seedSession(role = "client") {
  const user = {
    id: "user-1",
    email: "cliente@example.test",
    fullName: "Camila Vega",
    role,
    active: true,
    emailVerifiedAt: "2026-11-08T00:00:00.000Z",
    registrationStatus: "completed",
  };
  backing.set(
    CLIENT_SESSION_STORAGE_KEY,
    JSON.stringify({
      user,
      session: {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: Date.now() + 60 * 60_000,
      },
    }),
  );
  routes.set("GET /auth/me", () => reply(200, { user }));
}

const guarded = (area: "tabs" | "auth") => (
  <AuthProvider>
    <AuthGuard area={area}>
      <Text>protected-content</Text>
    </AuthGuard>
  </AuthProvider>
);

beforeEach(() => {
  backing.clear();
  routes.clear();
  mockPathname = "/";
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const route = routes.get(`${init.method ?? "GET"} ${new URL(url).pathname}`);
    if (!route) throw new Error("offline");
    return route();
  });
  (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

describe("customer tabs are closed until the gate passes (C9)", () => {
  it("sends a signed-out visitor to the welcome screen, never showing a tab", async () => {
    render(guarded("tabs"));

    expect(await screen.findByText("redirect:/auth/welcome")).toBeTruthy();
    expect(screen.queryByText("protected-content")).toBeNull();
  });

  it("shows nothing at all while the session is being restored", async () => {
    let finishRead!: (value: string | null) => void;
    (SecureStore.getItemAsync as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    );
    render(guarded("tabs"));

    expect(screen.queryByText(/redirect:/)).toBeNull();
    expect(screen.queryByText("protected-content")).toBeNull();

    await act(async () => {
      finishRead(null);
    });
    expect(await screen.findByText("redirect:/auth/welcome")).toBeTruthy();
  });

  it("opens for a restored, eligible and named customer", async () => {
    seedSession();
    routes.set("GET /api/v1/clientes/profile", () =>
      reply(200, { data: eligibleProfile }),
    );
    render(guarded("tabs"));

    expect(await screen.findByText("protected-content")).toBeTruthy();
    expect(screen.queryByText(/redirect:/)).toBeNull();
  });

  it("keeps the tabs closed while the profile is offline", async () => {
    seedSession();
    render(guarded("tabs"));

    expect(await screen.findByText("redirect:/auth/profile")).toBeTruthy();
    expect(screen.queryByText("protected-content")).toBeNull();
  });

  it("keeps the tabs closed for a customer without a birth date", async () => {
    seedSession();
    routes.set("GET /api/v1/clientes/profile", () =>
      reply(200, {
        data: { ...eligibleProfile, birthDate: null, eligibility: "birth_date_required" },
      }),
    );
    render(guarded("tabs"));

    expect(await screen.findByText("redirect:/auth/profile")).toBeTruthy();
    expect(screen.queryByText("protected-content")).toBeNull();
  });

  it("sends a non-client account to the dead end instead of looping", async () => {
    seedSession("tendero");
    render(guarded("tabs"));

    expect(await screen.findByText("redirect:/auth/profile")).toBeTruthy();
    expect(screen.queryByText("protected-content")).toBeNull();
  });
});

describe("auth routes follow the gate", () => {
  it("lets a signed-out visitor see the welcome flow", async () => {
    mockPathname = "/auth/welcome";
    render(guarded("auth"));

    expect(await screen.findByText("protected-content")).toBeTruthy();
  });

  it("sends an eligible customer from the welcome flow to the app", async () => {
    mockPathname = "/auth/welcome";
    seedSession();
    routes.set("GET /api/v1/clientes/profile", () =>
      reply(200, { data: eligibleProfile }),
    );
    render(guarded("auth"));

    expect(await screen.findByText("redirect:/")).toBeTruthy();
  });

  it("keeps a gated customer on the profile gate without redirecting again", async () => {
    mockPathname = "/auth/profile";
    seedSession();
    routes.set("GET /api/v1/clientes/profile", () =>
      reply(200, {
        data: { ...eligibleProfile, birthDate: null, eligibility: "birth_date_required" },
      }),
    );
    render(guarded("auth"));

    expect(await screen.findByText("protected-content")).toBeTruthy();
    expect(screen.queryByText(/redirect:/)).toBeNull();
  });
});

describe("route layouts use the guard", () => {
  it("the tabs layout renders no tab for a signed-out visitor, even on direct entry", async () => {
    mockPathname = "/wallet";
    render(
      <AuthProvider>
        <TabsLayout />
      </AuthProvider>,
    );

    expect(await screen.findByText("redirect:/auth/welcome")).toBeTruthy();
  });

  it("the tabs layout renders the tabs for an eligible customer", async () => {
    seedSession();
    routes.set("GET /api/v1/clientes/profile", () =>
      reply(200, { data: eligibleProfile }),
    );
    render(
      <AuthProvider>
        <TabsLayout />
      </AuthProvider>,
    );

    expect(await screen.findByText("tabs-visible")).toBeTruthy();
    expect(screen.queryByText(/redirect:/)).toBeNull();
  });

  it("the tabs layout keeps the tabs hidden for a gated customer", async () => {
    seedSession();
    render(
      <AuthProvider>
        <TabsLayout />
      </AuthProvider>,
    );

    expect(await screen.findByText("redirect:/auth/profile")).toBeTruthy();
    expect(screen.queryByText("tabs-visible")).toBeNull();
  });

  it("the auth layout shows its stack to a signed-out visitor", async () => {
    mockPathname = "/auth/welcome";
    render(
      <AuthProvider>
        <AuthLayout />
      </AuthProvider>,
    );

    expect(await screen.findByText("auth-stack")).toBeTruthy();
  });
});
