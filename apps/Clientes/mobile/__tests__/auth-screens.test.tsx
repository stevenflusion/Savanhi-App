import React from "react";
import { Linking, Text } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

import {
  AuthProvider,
  useAuth,
} from "@/src/features/auth/presentation/AuthProvider";
import EnterEmailScreen from "@/src/features/auth/presentation/screens/EnterEmailScreen";
import EnterOtpScreen from "@/src/features/auth/presentation/screens/EnterOtpScreen";
import ProfileGateScreen from "@/src/features/auth/presentation/screens/ProfileGateScreen";
import WelcomeScreen from "@/src/features/auth/presentation/screens/WelcomeScreen";
import { CLIENT_SESSION_STORAGE_KEY } from "@/src/features/auth/infrastructure/session-storage";
import ProfileScreen from "@/app/(tabs)/profile";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => "/",
  Redirect: () => null,
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaView: View,
  };
});

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

type Route = (body: any) => FakeResponse | Promise<FakeResponse> | Error;
const routes = new Map<string, Route>();
const calls: { key: string; body: any }[] = [];
const fetchMock = jest.fn();

const callsTo = (key: string) => calls.filter((call) => call.key === key);

function deferred() {
  let resolve!: (value: FakeResponse) => void;
  const promise = new Promise<FakeResponse>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const PROFILE_GET = "GET /api/v1/clientes/profile";
const PROFILE_PUT = "PUT /api/v1/clientes/profile";
const UNDERAGE = "Debes tener al menos 18 años para usar Savanhi";

const customer = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  email: "cliente@example.test",
  fullName: "",
  role: "client",
  active: true,
  emailVerifiedAt: "2026-11-08T00:00:00.000Z",
  registrationStatus: "profile_required",
  ...overrides,
});

function seedSession(userOverrides: Record<string, unknown> = {}) {
  const user = customer(userOverrides);
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

const profile = (overrides: Record<string, unknown> = {}) => ({
  fullName: "",
  birthDate: null,
  eligibility: "birth_date_required",
  ...overrides,
});

let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return <Text>{`gate:${auth.gate.status}`}</Text>;
}

const renderWithProvider = (ui: React.ReactElement) =>
  render(
    <AuthProvider>
      {ui}
      <Probe />
    </AuthProvider>,
  );

async function enterDate(day: string, month: string, year: string) {
  fireEvent.changeText(screen.getByLabelText("Día"), day);
  fireEvent.changeText(screen.getByLabelText("Mes"), month);
  fireEvent.changeText(screen.getByLabelText("Año"), year);
}

beforeEach(() => {
  backing.clear();
  routes.clear();
  calls.length = 0;
  mockParams = {};
  jest.clearAllMocks();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ key, body });
    const route = routes.get(key);
    if (!route) throw new Error(`unrouted ${key}`);
    const result = await route(body);
    if (result instanceof Error) throw result;
    return result;
  });
  (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

describe("welcome (C7)", () => {
  it("offers email only: no Google action and no merchant copy", () => {
    render(<WelcomeScreen />);

    expect(screen.getByText("Continuar con email")).toBeTruthy();
    expect(screen.queryByText(/Google/i)).toBeNull();
    expect(screen.queryByText(/tendero|tienda|negocio/i)).toBeNull();
  });

  it("opens the email step", () => {
    render(<WelcomeScreen />);

    fireEvent.press(screen.getByText("Continuar con email"));

    expect(mockRouter.push).toHaveBeenCalledWith("/auth/enter-email");
  });

  it("opens the example legal destination for both labels and survives a rejection", async () => {
    const open = jest
      .spyOn(Linking, "openURL")
      .mockRejectedValue(new Error("no handler"));
    render(<WelcomeScreen />);

    fireEvent.press(screen.getByText("Términos"));
    fireEvent.press(screen.getByText("Política de Privacidad"));
    await act(async () => {});

    expect(open.mock.calls).toEqual([
      ["https://savanhi.com"],
      ["https://savanhi.com"],
    ]);
    expect(screen.getByText("Continuar con email")).toBeTruthy();
    open.mockRestore();
  });
});

describe("email step (C7)", () => {
  it("requests a code and moves to the OTP step", async () => {
    routes.set("POST /auth/otp/request", () =>
      reply(200, { challengeId: "challenge-1", cooldownSeconds: 30 }),
    );
    renderWithProvider(<EnterEmailScreen />);
    await screen.findByText("gate:signed-out");

    fireEvent.changeText(
      screen.getByPlaceholderText("Introduce tu correo electrónico"),
      "cliente@example.test",
    );
    fireEvent.press(screen.getByText("Siguiente"));

    await waitFor(() => expect(mockRouter.push).toHaveBeenCalled());
    expect(callsTo("POST /auth/otp/request")[0]?.body).toEqual({
      email: "cliente@example.test",
    });
    expect(mockRouter.push.mock.calls[0]?.[0]).toContain("/auth/enter-otp?");
    expect(mockRouter.push.mock.calls[0]?.[0]).toContain("challengeId=challenge-1");
  });

  it("does not call the server for an invalid email", async () => {
    renderWithProvider(<EnterEmailScreen />);
    await screen.findByText("gate:signed-out");

    fireEvent.changeText(
      screen.getByPlaceholderText("Introduce tu correo electrónico"),
      "not-an-email",
    );
    fireEvent.press(screen.getByText("Siguiente"));
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows neutral Spanish when the server cannot be reached", async () => {
    routes.set("POST /auth/otp/request", () => new Error("offline"));
    renderWithProvider(<EnterEmailScreen />);
    await screen.findByText("gate:signed-out");

    fireEvent.changeText(
      screen.getByPlaceholderText("Introduce tu correo electrónico"),
      "cliente@example.test",
    );
    fireEvent.press(screen.getByText("Siguiente"));

    const alert = await screen.findByRole("alert");
    expect(JSON.stringify(alert.props.children)).not.toMatch(
      /Probá|Revisá|Intentá|offline/,
    );
  });
});

describe("OTP step (C1, C7)", () => {
  const CODE_LABEL = "Código de verificación de 6 dígitos";

  beforeEach(() => {
    mockParams = {
      email: "cliente@example.test",
      challengeId: "challenge-1",
      cooldownSeconds: "0",
    };
  });

  it("verifies the six digits as a client account and starts the session", async () => {
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: customer(),
        session: { accessToken: "a", refreshToken: "r", expiresIn: 900 },
      }),
    );
    routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
    renderWithProvider(<EnterOtpScreen />);
    await screen.findByText("gate:signed-out");

    fireEvent.changeText(screen.getByLabelText(CODE_LABEL), "123456");

    await screen.findByText("gate:profile-required");
    expect(callsTo("POST /auth/otp/verify")[0]?.body).toEqual({
      email: "cliente@example.test",
      challengeId: "challenge-1",
      token: "123456",
      registrationRole: "client",
    });
    expect(backing.has(CLIENT_SESSION_STORAGE_KEY)).toBe(true);
  });

  it("explains a wrong code in neutral Spanish and clears the field", async () => {
    routes.set("POST /auth/otp/verify", () =>
      reply(401, { error: "secret-detail", code: "incorrect_code" }),
    );
    renderWithProvider(<EnterOtpScreen />);
    await screen.findByText("gate:signed-out");

    fireEvent.changeText(screen.getByLabelText(CODE_LABEL), "000000");

    expect(
      await screen.findByText("El código es incorrecto. Inténtalo de nuevo."),
    ).toBeTruthy();
    expect(screen.queryByText(/secret-detail/)).toBeNull();
    expect(screen.getByLabelText(CODE_LABEL).props.value).toBe("");
    expect(backing.size).toBe(0);
  });

  it("goes back to the email step when the challenge is missing", async () => {
    mockParams = {};
    renderWithProvider(<EnterOtpScreen />);
    await screen.findByText("gate:signed-out");

    expect(mockRouter.replace).toHaveBeenCalledWith("/auth/enter-email");
  });
});

describe("profile gate: who is asked for what (C8, C9)", () => {
  it("asks a new customer for name, optional surname and birth date", async () => {
    seedSession();
    routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
    renderWithProvider(<ProfileGateScreen />);

    expect(await screen.findByText("Completa tu perfil")).toBeTruthy();
    expect(screen.getByLabelText("Nombre")).toBeTruthy();
    expect(screen.getByLabelText("Apellido (opcional)")).toBeTruthy();
    expect(screen.getByText("Fecha de nacimiento")).toBeTruthy();
    expect(screen.getByText("Día / Mes / Año")).toBeTruthy();
    expect(screen.getByText("Continuar")).toBeTruthy();
    expect(screen.getByText("Cerrar sesión")).toBeTruthy();
    expect(screen.queryByText(UNDERAGE)).toBeNull();
  });

  it("asks only for the birth date when a name is already saved", async () => {
    seedSession({ fullName: "María del Carmen Pérez" });
    routes.set(PROFILE_GET, () =>
      reply(200, { data: profile({ fullName: "María del Carmen Pérez" }) }),
    );
    routes.set(PROFILE_PUT, (body) =>
      reply(200, {
        data: profile({
          fullName: body.fullName,
          birthDate: body.birthDate,
          eligibility: "eligible",
        }),
      }),
    );
    renderWithProvider(<ProfileGateScreen />);

    expect(
      await screen.findByText("Completa tu fecha de nacimiento"),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(screen.queryByLabelText("Apellido (opcional)")).toBeNull();

    await enterDate("04", "11", "2002");
    fireEvent.press(screen.getByText("Continuar"));

    await screen.findByText("gate:ready");
    expect(callsTo(PROFILE_PUT)[0]?.body).toEqual({
      fullName: "María del Carmen Pérez",
      birthDate: "2002-11-04",
    });
  });

  it("keeps a saved birth date when only the name is missing", async () => {
    seedSession();
    routes.set(PROFILE_GET, () =>
      reply(200, {
        data: profile({ birthDate: "2002-11-04", eligibility: "eligible" }),
      }),
    );
    renderWithProvider(<ProfileGateScreen />);

    expect(await screen.findByText("Completa tu perfil")).toBeTruthy();
    expect(screen.getByLabelText("Día").props.value).toBe("04");
    expect(screen.getByLabelText("Mes").props.value).toBe("11");
    expect(screen.getByLabelText("Año").props.value).toBe("2002");
  });

  it("shows the exact under-18 sentence as soon as the profile is read", async () => {
    seedSession({ fullName: "Camila Vega" });
    routes.set(PROFILE_GET, () =>
      reply(200, {
        data: profile({
          fullName: "Camila Vega",
          birthDate: "2012-01-01",
          eligibility: "underage",
        }),
      }),
    );
    renderWithProvider(<ProfileGateScreen />);

    expect(await screen.findByText(UNDERAGE)).toBeTruthy();
    expect(screen.getByText("Cerrar sesión")).toBeTruthy();
    expect(screen.getByLabelText("Día").props.value).toBe("01");
    expect(callsTo(PROFILE_PUT)).toHaveLength(0);
  });
});

describe("profile gate: saving (C8, C9)", () => {
  beforeEach(() => {
    seedSession();
    routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
    routes.set(PROFILE_PUT, (body) =>
      reply(200, {
        data: profile({ ...body, eligibility: "eligible" }),
      }),
    );
  });

  it("composes name and surname into one fullName and opens the app", async () => {
    renderWithProvider(<ProfileGateScreen />);
    await screen.findByText("Completa tu perfil");

    fireEvent.changeText(screen.getByLabelText("Nombre"), "  Camila ");
    fireEvent.changeText(screen.getByLabelText("Apellido (opcional)"), "Vega");
    await enterDate("04", "11", "2002");
    fireEvent.press(screen.getByText("Continuar"));

    await screen.findByText("gate:ready");
    expect(callsTo(PROFILE_PUT)[0]?.body).toEqual({
      fullName: "Camila Vega",
      birthDate: "2002-11-04",
    });
  });

  it("sends the name alone when the surname is left empty", async () => {
    renderWithProvider(<ProfileGateScreen />);
    await screen.findByText("Completa tu perfil");

    fireEvent.changeText(screen.getByLabelText("Nombre"), "Camila");
    await enterDate("04", "11", "2002");
    fireEvent.press(screen.getByText("Continuar"));

    await screen.findByText("gate:ready");
    expect(callsTo(PROFILE_PUT)[0]?.body).toEqual({
      fullName: "Camila",
      birthDate: "2002-11-04",
    });
  });

  it("blocks a blank name without any network call", async () => {
    renderWithProvider(<ProfileGateScreen />);
    await screen.findByText("Completa tu perfil");

    fireEvent.changeText(screen.getByLabelText("Nombre"), "   ");
    await enterDate("04", "11", "2002");
    fireEvent.press(screen.getByText("Continuar"));

    expect(await screen.findByText("Ingresa tu nombre")).toBeTruthy();
    expect(callsTo(PROFILE_PUT)).toHaveLength(0);
  });

  it("blocks an incomplete date without any network call", async () => {
    renderWithProvider(<ProfileGateScreen />);
    await screen.findByText("Completa tu perfil");

    fireEvent.changeText(screen.getByLabelText("Nombre"), "Camila");
    fireEvent.changeText(screen.getByLabelText("Día"), "04");
    fireEvent.press(screen.getByText("Continuar"));

    expect(
      await screen.findByText("Completa tu fecha de nacimiento"),
    ).toBeTruthy();
    expect(callsTo(PROFILE_PUT)).toHaveLength(0);
  });

  it("blocks an impossible date without any network call", async () => {
    renderWithProvider(<ProfileGateScreen />);
    await screen.findByText("Completa tu perfil");

    fireEvent.changeText(screen.getByLabelText("Nombre"), "Camila");
    await enterDate("31", "02", "2002");
    fireEvent.press(screen.getByText("Continuar"));

    expect(await screen.findByText("Ingresa una fecha válida")).toBeTruthy();
    expect(callsTo(PROFILE_PUT)).toHaveLength(0);
  });

  it("moves focus through the three fields and lets any part be edited again", async () => {
    renderWithProvider(<ProfileGateScreen />);
    await screen.findByText("Completa tu perfil");
    const selected = (label: string) =>
      screen.getByLabelText(label).props.accessibilityState?.selected === true;

    fireEvent.changeText(screen.getByLabelText("Día"), "0");
    expect(selected("Mes")).toBe(false);
    fireEvent.changeText(screen.getByLabelText("Día"), "04");
    expect(selected("Mes")).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Mes"), "11");
    expect(selected("Año")).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Año"), "2002");

    fireEvent(screen.getByLabelText("Día"), "focus");
    expect(selected("Día")).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Día"), "05");
    expect(screen.getByLabelText("Día").props.value).toBe("05");
    expect(screen.getByLabelText("Mes").props.value).toBe("11");
    expect(screen.getByLabelText("Año").props.value).toBe("2002");

    fireEvent(screen.getByLabelText("Mes"), "focus");
    fireEvent.changeText(screen.getByLabelText("Mes"), "");
    fireEvent(screen.getByLabelText("Mes"), "keyPress", {
      nativeEvent: { key: "Backspace" },
    });
    expect(selected("Día")).toBe(true);
  });

  it("shows the under-18 sentence on a server refusal and stays gated", async () => {
    routes.set(PROFILE_PUT, () =>
      reply(422, {
        error: "You must be at least 18 years old to use Savanhi.",
        details: { eligibility: "underage", minimumAge: 18 },
      }),
    );
    renderWithProvider(<ProfileGateScreen />);
    await screen.findByText("Completa tu perfil");
    const storedBefore = backing.get(CLIENT_SESSION_STORAGE_KEY);

    fireEvent.changeText(screen.getByLabelText("Nombre"), "Camila");
    await enterDate("08", "11", "2012");
    fireEvent.press(screen.getByText("Continuar"));

    expect(await screen.findByText(UNDERAGE)).toBeTruthy();
    expect(screen.getByText("gate:profile-required")).toBeTruthy();
    expect(screen.queryByText(/at least 18 years/)).toBeNull();
    expect(backing.get(CLIENT_SESSION_STORAGE_KEY)).toBe(storedBefore);
    // The date can be corrected and sent again.
    routes.set(PROFILE_PUT, (body) =>
      reply(200, { data: profile({ ...body, eligibility: "eligible" }) }),
    );
    await enterDate("08", "11", "2002");
    fireEvent.press(screen.getByText("Continuar"));
    await screen.findByText("gate:ready");
  });

  it("shows the save error for any other failure, without server text", async () => {
    routes.set(PROFILE_PUT, () => reply(500, { error: "secret-detail" }));
    renderWithProvider(<ProfileGateScreen />);
    await screen.findByText("Completa tu perfil");

    fireEvent.changeText(screen.getByLabelText("Nombre"), "Camila");
    await enterDate("04", "11", "2002");
    fireEvent.press(screen.getByText("Continuar"));

    expect(
      await screen.findByText(
        "No pudimos guardar tu perfil. Intenta de nuevo",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/secret-detail/)).toBeNull();
    expect(screen.getByText("gate:profile-required")).toBeTruthy();
  });
});

describe("profile gate: load failures and dead ends (C9)", () => {
  it("offers a retry when the profile cannot be loaded, and recovers", async () => {
    seedSession({ fullName: "Camila Vega" });
    routes.set(PROFILE_GET, () => new Error("offline"));
    renderWithProvider(<ProfileGateScreen />);

    expect(
      await screen.findByText("No pudimos cargar tu perfil. Intenta de nuevo"),
    ).toBeTruthy();
    expect(screen.getByText("Cerrar sesión")).toBeTruthy();
    expect(screen.getByText("gate:profile-error")).toBeTruthy();

    routes.set(PROFILE_GET, () =>
      reply(200, {
        data: profile({
          fullName: "Camila Vega",
          birthDate: "2002-11-04",
          eligibility: "eligible",
        }),
      }),
    );
    fireEvent.press(screen.getByText("Reintentar"));

    await screen.findByText("gate:ready");
    expect(callsTo(PROFILE_GET)).toHaveLength(2);
  });

  it("ends a non-client account at a dead end with sign out, no profile call", async () => {
    seedSession({ role: "tendero", registrationStatus: "completed" });
    routes.set("POST /auth/logout", () => reply(200, {}));
    renderWithProvider(<ProfileGateScreen />);

    expect(await screen.findByText("Esta cuenta no es de cliente")).toBeTruthy();
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(callsTo(PROFILE_GET)).toHaveLength(0);
    expect(backing.has(CLIENT_SESSION_STORAGE_KEY)).toBe(true);

    fireEvent.press(screen.getByText("Cerrar sesión"));

    await screen.findByText("gate:signed-out");
    expect(backing.size).toBe(0);
    expect(callsTo("POST /auth/logout")).toHaveLength(1);
  });

  it("treats a 403 from the profile route as the same dead end", async () => {
    seedSession();
    routes.set(PROFILE_GET, () =>
      reply(403, { error: "You do not have access to this resource." }),
    );
    renderWithProvider(<ProfileGateScreen />);

    expect(await screen.findByText("Esta cuenta no es de cliente")).toBeTruthy();
  });

  it("signs out from the profile tab", async () => {
    seedSession({ fullName: "Camila Vega" });
    routes.set(PROFILE_GET, () =>
      reply(200, {
        data: profile({
          fullName: "Camila Vega",
          birthDate: "2002-11-04",
          eligibility: "eligible",
        }),
      }),
    );
    routes.set("POST /auth/logout", () => reply(200, {}));
    renderWithProvider(<ProfileScreen />);
    await screen.findByText("gate:ready");

    expect(screen.getByText("Perfil")).toBeTruthy();
    fireEvent.press(screen.getByText("Cerrar sesión"));

    await screen.findByText("gate:signed-out");
    expect(backing.size).toBe(0);
  });
});

describe("stale async work after sign out (T2c)", () => {
  it("ignores a profile read that finishes after logout", async () => {
    seedSession({ fullName: "Camila Vega" });
    routes.set("POST /auth/logout", () => reply(200, {}));
    const pending = deferred();
    routes.set(PROFILE_GET, () => pending.promise);
    renderWithProvider(<ProfileGateScreen />);
    await waitFor(() => expect(callsTo(PROFILE_GET)).toHaveLength(1));

    await act(async () => {
      await auth.logout();
    });
    await act(async () => {
      pending.resolve(
        reply(200, {
          data: profile({
            fullName: "Camila Vega",
            birthDate: "2002-11-04",
            eligibility: "eligible",
          }),
        }),
      );
    });

    expect(screen.getByText("gate:signed-out")).toBeTruthy();
    expect(backing.size).toBe(0);
  });

  it("ignores a profile save that finishes after logout", async () => {
    seedSession();
    routes.set("POST /auth/logout", () => reply(200, {}));
    routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
    const pending = deferred();
    routes.set(PROFILE_PUT, () => pending.promise);
    renderWithProvider(<ProfileGateScreen />);
    await screen.findByText("Completa tu perfil");

    fireEvent.changeText(screen.getByLabelText("Nombre"), "Camila");
    await enterDate("04", "11", "2002");
    fireEvent.press(screen.getByText("Continuar"));
    await waitFor(() => expect(callsTo(PROFILE_PUT)).toHaveLength(1));

    await act(async () => {
      await auth.logout();
    });
    await act(async () => {
      pending.resolve(
        reply(200, {
          data: profile({
            fullName: "Camila",
            birthDate: "2002-11-04",
            eligibility: "eligible",
          }),
        }),
      );
    });

    expect(screen.getByText("gate:signed-out")).toBeTruthy();
    expect(backing.size).toBe(0);
  });
});
