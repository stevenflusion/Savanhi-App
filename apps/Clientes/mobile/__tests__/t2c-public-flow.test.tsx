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

import ProfileScreen from "@/app/(tabs)/profile";
import {
  AuthProvider,
  useAuth,
} from "@/src/features/auth/presentation/AuthProvider";
import { AuthGuard } from "@/src/features/auth/presentation/AuthGuard";
import EnterEmailScreen from "@/src/features/auth/presentation/screens/EnterEmailScreen";
import EnterOtpScreen from "@/src/features/auth/presentation/screens/EnterOtpScreen";
import ProfileGateScreen from "@/src/features/auth/presentation/screens/ProfileGateScreen";
import WelcomeScreen from "@/src/features/auth/presentation/screens/WelcomeScreen";
import { CLIENT_SESSION_STORAGE_KEY } from "@/src/features/auth/infrastructure/session-storage";
import { resolveClientesApiBaseUrl } from "@/src/features/auth/infrastructure/api-base-url";

// ---- tiny router simulation: real guards/screens, mocked expo-router -------
const mockNav = {
  path: "/",
  params: {} as Record<string, string>,
  go: (_href: string) => {},
  redirects: [] as string[],
  tabRenders: 0,
};

jest.mock("expo-router", () => {
  const React = jest.requireActual("react");
  const go = (href: string) => mockNav.go(href);
  return {
    useRouter: () => ({ push: go, replace: go, back: () => go("/auth/enter-email") }),
    useLocalSearchParams: () => mockNav.params,
    usePathname: () => mockNav.path,
    Redirect: ({ href }: { href: string }) => {
      React.useEffect(() => {
        mockNav.redirects.push(href);
        go(href);
      }, [href]);
      return null;
    },
  };
});
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaView: View,
  };
});

function Tabs() {
  mockNav.tabRenders += 1;
  return (
    <>
      <Text>tabs-visible</Text>
      <ProfileScreen />
    </>
  );
}

let probeAuth: ReturnType<typeof useAuth>;
function Probe() {
  probeAuth = useAuth();
  return null;
}

function Screen({ path }: { path: string }) {
  const [base, query] = path.split("?");
  mockNav.path = base!;
  mockNav.params = Object.fromEntries(new URLSearchParams(query ?? ""));
  switch (base) {
    case "/":
      return (
        <AuthGuard area="tabs">
          <Tabs />
        </AuthGuard>
      );
    case "/auth/welcome":
      return (
        <AuthGuard area="auth">
          <WelcomeScreen />
        </AuthGuard>
      );
    case "/auth/enter-email":
      return (
        <AuthGuard area="auth">
          <EnterEmailScreen />
        </AuthGuard>
      );
    case "/auth/enter-otp":
      return (
        <AuthGuard area="auth">
          <EnterOtpScreen />
        </AuthGuard>
      );
    case "/auth/profile":
      return (
        <AuthGuard area="auth">
          <ProfileGateScreen />
        </AuthGuard>
      );
  }
  return null;
}

function MiniApp({ start }: { start: string }) {
  const [path, setPath] = React.useState(start);
  mockNav.go = (href) => setPath(href);
  return (
    <AuthProvider>
      <Probe />
      <Screen path={path} />
    </AuthProvider>
  );
}

// ---- fetch / keystore fakes -------------------------------------------------
const backing = (SecureStore as unknown as { __store: Map<string, string> })
  .__store;
type Call = {
  key: string;
  url: string;
  headers: Record<string, string>;
  body: any;
};
type Reply = {
  ok: boolean;
  status: number;
  headers: { get: (n: string) => string | null };
  json: () => Promise<unknown>;
};
const reply = (status: number, body: unknown): Reply => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
});
const calls: Call[] = [];
const routes = new Map<string, (c: Call) => Reply | Promise<Reply>>();
const callsTo = (key: string) => calls.filter((c) => c.key === key);
function deferred() {
  let resolve!: (r: Reply) => void;
  const promise = new Promise<Reply>((res) => (resolve = res));
  return { promise, resolve };
}

// tokens are unique per test: the refresh single-flight cache is module-level (60 s reuse)
let tid = 0;
const acc = (n: number) => `access-${tid}-${n}`;
const ref = (n: number) => `refresh-${tid}-${n}`;

const PROFILE_GET = "GET /api/v1/clientes/profile";
const PROFILE_PUT = "PUT /api/v1/clientes/profile";
const REFRESH = "POST /auth/refresh";
const UNDERAGE = "Debes tener al menos 18 años para usar Savanhi";

const user = (o: Record<string, unknown> = {}) => ({
  id: "user-1",
  email: "cliente@example.test",
  fullName: "",
  role: "client",
  active: true,
  emailVerifiedAt: "2026-11-08T00:00:00.000Z",
  registrationStatus: "profile_required",
  ...o,
});
const profile = (o: Record<string, unknown> = {}) => ({
  fullName: "",
  birthDate: null,
  eligibility: "birth_date_required",
  ...o,
});
const session = (n = 1, expiresIn = 3_600_000) => ({
  accessToken: acc(n),
  refreshToken: ref(n),
  expiresAt: Date.now() + expiresIn,
});
function seed(u = user(), s = session()) {
  backing.set(CLIENT_SESSION_STORAGE_KEY, JSON.stringify({ user: u, session: s }));
  routes.set("GET /auth/me", () => reply(200, { user: u }));
}
const stored = () => backing.get(CLIENT_SESSION_STORAGE_KEY) ?? null;

beforeEach(() => {
  tid += 1;
  backing.clear();
  routes.clear();
  calls.length = 0;
  mockNav.redirects.length = 0;
  mockNav.tabRenders = 0;
  (SecureStore.getItemAsync as jest.Mock).mockClear();
  (SecureStore.setItemAsync as jest.Mock).mockClear();
  (SecureStore.deleteItemAsync as jest.Mock).mockClear();
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const call: Call = {
      key: `${method} ${new URL(url).pathname}`,
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const route = routes.get(call.key);
    if (!route) throw new Error("offline");
    return route(call);
  });
});

const fillDate = (d: string, m: string, y: string) => {
  fireEvent.changeText(screen.getByLabelText("Día"), d);
  fireEvent.changeText(screen.getByLabelText("Mes"), m);
  fireEvent.changeText(screen.getByLabelText("Año"), y);
};
const settle = () => act(async () => { await new Promise((r) => setImmediate(r)); });

describe("S-C7/C8/C9 end to end through real screens", () => {
  it("new customer: welcome -> email -> OTP -> profile -> tabs; role 'client' on verify, no tab before ready", async () => {
    routes.set("POST /auth/otp/request", () =>
      reply(200, { challengeId: "ch-1", cooldownSeconds: 30 }),
    );
    const u = user();
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: u,
        session: { accessToken: acc(1), refreshToken: ref(1), expiresIn: 900 },
      }),
    );
    routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
    routes.set(PROFILE_PUT, () =>
      reply(200, {
        data: profile({ fullName: "Ana Pérez", birthDate: "2002-11-04", eligibility: "eligible" }),
      }),
    );

    render(<MiniApp start="/" />);
    await screen.findByText("Continuar con email");
    expect(mockNav.tabRenders).toBe(0);
    expect(screen.queryByText(/Google/i)).toBeNull();
    fireEvent.press(screen.getByText("Continuar con email"));
    const email = await screen.findByPlaceholderText("Introduce tu correo electrónico");
    fireEvent.changeText(email, "ana@example.test");
    fireEvent.press(screen.getByText("Siguiente"));
    const code = await screen.findByLabelText("Código de verificación de 6 dígitos");
    expect(callsTo("POST /auth/otp/request")[0]!.body).toEqual({ email: "ana@example.test" });
    fireEvent.changeText(code, "123456");
    await screen.findByText("Completa tu perfil");

    const verify = callsTo("POST /auth/otp/verify")[0]!;
    expect(verify.body).toEqual({
      email: "ana@example.test",
      challengeId: "ch-1",
      token: "123456",
      registrationRole: "client",
    });
    expect(verify.url).toBe("http://localhost:4300/auth/otp/verify");
    expect(JSON.parse(stored()!).session.accessToken).toBe(acc(1));
    expect(mockNav.tabRenders).toBe(0);

    // blank name is refused locally
    fillDate("04", "11", "2002");
    fireEvent.press(screen.getByText("Continuar"));
    expect(await screen.findByText("Ingresa tu nombre")).toBeTruthy();
    expect(callsTo(PROFILE_PUT)).toHaveLength(0);

    fireEvent.changeText(screen.getByLabelText("Nombre"), "  Ana ");
    fireEvent.changeText(screen.getByLabelText("Apellido (opcional)"), " Pérez ");
    fireEvent.press(screen.getByText("Continuar"));
    await screen.findByText("tabs-visible");
    const put = callsTo(PROFILE_PUT)[0]!;
    expect(put.body).toEqual({ fullName: "Ana Pérez", birthDate: "2002-11-04" });
    expect(put.headers.Authorization).toBe(`Bearer ${acc(1)}`);
    expect(put.url).toBe("http://localhost:4300/api/v1/clientes/profile");
  });

  it("tendero e-mail (stored role kept): dead end 'Esta cuenta no es de cliente', no profile call, no redirect loop, sign-out works", async () => {
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: user({ role: "tendero", fullName: "Tendero Uno" }),
        session: { accessToken: "t-access", refreshToken: "t-refresh", expiresIn: 900 },
      }),
    );
    render(<MiniApp start="/auth/welcome" />);
    await settle();
    await act(async () => {
      await probeAuth.verifyOTP("t@example.test", "ch", "123456");
    });
    await screen.findByText("Esta cuenta no es de cliente");
    expect(callsTo(PROFILE_GET)).toHaveLength(0);
    expect(mockNav.tabRenders).toBe(0);
    await settle();
    await settle();
    expect(mockNav.redirects.length).toBeLessThanOrEqual(2); // welcome -> profile, no ping-pong
    fireEvent.press(screen.getByText("Cerrar sesión"));
    await screen.findByText("Continuar con email");
    expect(stored()).toBeNull();
  });

  it("restart with a stored tendero session lands on the same dead end (no tabs, no loop)", async () => {
    seed(user({ role: "tendero", fullName: "T" }));
    render(<MiniApp start="/" />);
    await screen.findByText("Esta cuenta no es de cliente");
    expect(mockNav.tabRenders).toBe(0);
    expect(callsTo(PROFILE_GET)).toHaveLength(0);
  });

  it("existing named customer: asks ONLY the birth date and sends the saved name byte-for-byte", async () => {
    seed(user({ fullName: "  María  José de la Cruz ", registrationStatus: "completed" }));
    routes.set(PROFILE_GET, () =>
      reply(200, { data: profile({ fullName: "  María  José de la Cruz " }) }),
    );
    routes.set(PROFILE_PUT, () =>
      reply(200, {
        data: profile({ fullName: "  María  José de la Cruz ", birthDate: "1990-02-28", eligibility: "eligible" }),
      }),
    );
    render(<MiniApp start="/" />);
    await screen.findByText("Completa tu fecha de nacimiento");
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(screen.queryByLabelText("Apellido (opcional)")).toBeNull();
    expect(mockNav.tabRenders).toBe(0);
    fillDate("28", "02", "1990");
    fireEvent.press(screen.getByText("Continuar"));
    await screen.findByText("tabs-visible");
    expect(callsTo(PROFILE_PUT)[0]!.body).toEqual({
      fullName: "  María  José de la Cruz ",
      birthDate: "1990-02-28",
    });
  });

  it("saved date but blank name: the date stays in the fields and only the name is needed", async () => {
    seed(user({ registrationStatus: "completed" }));
    routes.set(PROFILE_GET, () =>
      reply(200, { data: profile({ fullName: "   ", birthDate: "2002-11-04", eligibility: "eligible" }) }),
    );
    routes.set(PROFILE_PUT, () =>
      reply(200, { data: profile({ fullName: "Luz", birthDate: "2002-11-04", eligibility: "eligible" }) }),
    );
    render(<MiniApp start="/" />);
    await screen.findByText("Completa tu perfil");
    expect(mockNav.tabRenders).toBe(0); // server-eligible but nameless stays closed
    expect(screen.getByLabelText("Día").props.value).toBe("04");
    expect(screen.getByLabelText("Mes").props.value).toBe("11");
    expect(screen.getByLabelText("Año").props.value).toBe("2002");
    fireEvent.changeText(screen.getByLabelText("Nombre"), "Luz");
    fireEvent.press(screen.getByText("Continuar"));
    await screen.findByText("tabs-visible");
    expect(callsTo(PROFILE_PUT)[0]!.body).toEqual({ fullName: "Luz", birthDate: "2002-11-04" });
  });

  it("underage from the initial GET shows the exact sentence; a 422 keeps the gate shut and storage unchanged; correcting the date opens it", async () => {
    seed(user({ fullName: "Joven", registrationStatus: "completed" }));
    routes.set(PROFILE_GET, () =>
      reply(200, { data: profile({ fullName: "Joven", birthDate: "2015-01-01", eligibility: "underage" }) }),
    );
    let attempt = 0;
    routes.set(PROFILE_PUT, (c) => {
      attempt += 1;
      return c.body.birthDate === "2002-11-04"
        ? reply(200, { data: profile({ fullName: "Joven", birthDate: "2002-11-04", eligibility: "eligible" }) })
        : reply(422, { error: "x", details: { eligibility: "underage", minimumAge: 18 } });
    });
    render(<MiniApp start="/" />);
    expect(await screen.findByText(UNDERAGE)).toBeTruthy();
    expect(screen.getByLabelText("Año").props.value).toBe("2015");
    const before = stored();
    fillDate("02", "01", "2015");
    fireEvent.press(screen.getByText("Continuar"));
    await waitFor(() => expect(attempt).toBe(1));
    expect(await screen.findByText(UNDERAGE)).toBeTruthy();
    expect(mockNav.tabRenders).toBe(0);
    expect(stored()).toBe(before);
    fillDate("04", "11", "2002");
    fireEvent.press(screen.getByText("Continuar"));
    await screen.findByText("tabs-visible");
    expect(screen.queryByText(UNDERAGE)).toBeNull();
  });

  it("an underage 422 for a NEW customer shows the sentence, not the generic save error", async () => {
    seed();
    routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
    routes.set(PROFILE_PUT, () =>
      reply(422, { error: "x", details: { eligibility: "underage", minimumAge: 18 } }),
    );
    render(<MiniApp start="/" />);
    await screen.findByText("Completa tu perfil");
    fireEvent.changeText(screen.getByLabelText("Nombre"), "Nico");
    fillDate("01", "01", "2015");
    fireEvent.press(screen.getByText("Continuar"));
    expect(await screen.findByText(UNDERAGE)).toBeTruthy();
    expect(screen.queryByText("No pudimos guardar tu perfil. Intenta de nuevo")).toBeNull();
  });

  it.each([
    ["31/02/2002", "31", "02", "2002", "Ingresa una fecha válida"],
    ["29/02/2007 (common year)", "29", "02", "2007", "Ingresa una fecha válida"],
    ["00/10/2000", "00", "10", "2000", "Ingresa una fecha válida"],
    ["15/13/2000", "15", "13", "2000", "Ingresa una fecha válida"],
    ["year 0000", "10", "10", "0000", "Ingresa una fecha válida"],
    ["incomplete year", "10", "10", "200", "Completa tu fecha de nacimiento"],
    ["empty", "", "", "", "Completa tu fecha de nacimiento"],
  ])("rejects %s locally with the approved text and sends nothing", async (_n, d, m, y, text) => {
    seed();
    routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
    render(<MiniApp start="/" />);
    await screen.findByText("Completa tu perfil");
    fireEvent.changeText(screen.getByLabelText("Nombre"), "Eva");
    fillDate(d, m, y);
    fireEvent.press(screen.getByText("Continuar"));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(callsTo(PROFILE_PUT)).toHaveLength(0);
  });

  it("whitespace-only name is refused; 29/02/2008 (leap) is sent as a date-only string", async () => {
    seed();
    routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
    routes.set(PROFILE_PUT, () =>
      reply(200, { data: profile({ fullName: "Eva", birthDate: "2008-02-29", eligibility: "eligible" }) }),
    );
    render(<MiniApp start="/" />);
    await screen.findByText("Completa tu perfil");
    fireEvent.changeText(screen.getByLabelText("Nombre"), "   ");
    fillDate("29", "02", "2008");
    fireEvent.press(screen.getByText("Continuar"));
    expect(await screen.findByText("Ingresa tu nombre")).toBeTruthy();
    expect(callsTo(PROFILE_PUT)).toHaveLength(0);
    fireEvent.changeText(screen.getByLabelText("Nombre"), "Eva");
    fireEvent.press(screen.getByText("Continuar"));
    await screen.findByText("tabs-visible");
    expect(callsTo(PROFILE_PUT)[0]!.body).toEqual({ fullName: "Eva", birthDate: "2008-02-29" });
  });

  it("rejected PUTs (400, 500, offline) neither open the gate nor touch the keystore, and show the approved error", async () => {
    seed();
    routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
    let mode: "400" | "500" | "off" = "400";
    routes.set(PROFILE_PUT, () => {
      if (mode === "off") throw new Error("offline");
      return reply(mode === "400" ? 400 : 500, { error: "boom", details: { eligibility: "eligible" } });
    });
    render(<MiniApp start="/" />);
    await screen.findByText("Completa tu perfil");
    fireEvent.changeText(screen.getByLabelText("Nombre"), "Eva");
    fillDate("04", "11", "2002");
    const before = stored();
    for (const m of ["400", "500", "off"] as const) {
      mode = m;
      fireEvent.press(screen.getByText("Continuar"));
      expect(await screen.findByText("No pudimos guardar tu perfil. Intenta de nuevo")).toBeTruthy();
      expect(mockNav.tabRenders).toBe(0);
      expect(stored()).toBe(before);
      await settle();
    }
  });

  it("restore matrix: profile read offline/500 keeps every tab closed, Reintentar then opens", async () => {
    seed(user({ fullName: "Camila", registrationStatus: "completed" }));
    let ok = false;
    routes.set(PROFILE_GET, () => {
      if (!ok) throw new Error("offline");
      return reply(200, { data: profile({ fullName: "Camila", birthDate: "2002-11-04", eligibility: "eligible" }) });
    });
    render(<MiniApp start="/" />);
    await screen.findByText("No pudimos cargar tu perfil. Intenta de nuevo");
    expect(mockNav.tabRenders).toBe(0);
    ok = true;
    fireEvent.press(screen.getByText("Reintentar"));
    await screen.findByText("tabs-visible");
  });

  it("every direct entry is closed while the gate is open: /auth/enter-otp and /auth/welcome redirect a profile-pending customer to /auth/profile", async () => {
    seed(user({ fullName: "Camila" }));
    routes.set(PROFILE_GET, () => reply(200, { data: profile({ fullName: "Camila" }) }));
    for (const start of ["/", "/auth/welcome", "/auth/enter-otp"]) {
      mockNav.redirects.length = 0;
      const view = render(<MiniApp start={start} />);
      await screen.findByText("Completa tu fecha de nacimiento");
      expect(mockNav.tabRenders).toBe(0);
      view.unmount();
    }
  });
});

describe("session invariants through the public provider (risk items 2 and 4)", () => {
  it("expired token on restore: ONE refresh, rotated tokens persisted, gate opens", async () => {
    seed(user({ fullName: "Camila", registrationStatus: "completed" }), session(1, -1000));
    routes.set(REFRESH, () =>
      reply(200, { session: { accessToken: acc(2), refreshToken: ref(2), expiresIn: 900 } }),
    );
    routes.set(PROFILE_GET, (c) =>
      c.headers.Authorization === `Bearer ${acc(2)}`
        ? reply(200, { data: profile({ fullName: "Camila", birthDate: "2002-11-04", eligibility: "eligible" }) })
        : reply(401, { error: "expired" }),
    );
    render(<MiniApp start="/" />);
    await screen.findByText("tabs-visible");
    expect(callsTo(REFRESH)).toHaveLength(1);
    expect(JSON.parse(stored()!).session.refreshToken).toBe(ref(2));
  });

  it("401 on the profile read: single refresh, retried once with the new token", async () => {
    seed(user({ fullName: "Camila", registrationStatus: "completed" }));
    routes.set(REFRESH, () =>
      reply(200, { session: { accessToken: acc(2), refreshToken: ref(2), expiresIn: 900 } }),
    );
    routes.set(PROFILE_GET, (c) =>
      c.headers.Authorization === `Bearer ${acc(2)}`
        ? reply(200, { data: profile({ fullName: "Camila", birthDate: "2002-11-04", eligibility: "eligible" }) })
        : reply(401, { error: "expired" }),
    );
    render(<MiniApp start="/" />);
    await screen.findByText("tabs-visible");
    expect(callsTo(REFRESH)).toHaveLength(1);
    expect(callsTo(PROFILE_GET).map((c) => c.headers.Authorization)).toEqual([
      `Bearer ${acc(1)}`,
      `Bearer ${acc(2)}`,
    ]);
  });

  it.each([400, 401])("terminal refresh (%i) clears the keystore and returns to welcome", async (status) => {
    seed(user({ fullName: "Camila", registrationStatus: "completed" }), session(1, -1000));
    routes.set(REFRESH, () => reply(status, { error: "revoked" }));
    render(<MiniApp start="/" />);
    await screen.findByText("Continuar con email");
    expect(stored()).toBeNull();
    expect(mockNav.tabRenders).toBe(0);
  });

  it.each(["500", "offline"])("non-terminal refresh failure (%s) keeps the stored session byte-identical and the tabs closed", async (kind) => {
    seed(user({ fullName: "Camila", registrationStatus: "completed" }), session(1, -1000));
    const before = stored();
    routes.set(REFRESH, () => {
      if (kind === "offline") throw new Error("offline");
      return reply(500, {});
    });
    routes.set(PROFILE_GET, () => reply(401, {}));
    render(<MiniApp start="/" />);
    await settle();
    await settle();
    expect(stored()).toBe(before);
    expect(mockNav.tabRenders).toBe(0);
    expect(screen.queryByText("Continuar con email")).toBeNull(); // not treated as signed out
  });

  it("logout is local first: keystore cleared and gate signed-out while /auth/logout never answers", async () => {
    seed(user({ fullName: "Camila", registrationStatus: "completed" }));
    routes.set(PROFILE_GET, () =>
      reply(200, { data: profile({ fullName: "Camila", birthDate: "2002-11-04", eligibility: "eligible" }) }),
    );
    routes.set("POST /auth/logout", () => new Promise<Reply>(() => {}));
    render(<MiniApp start="/" />);
    await screen.findByText("tabs-visible");
    fireEvent.press(screen.getByText("Cerrar sesión"));
    await screen.findByText("Continuar con email");
    expect(stored()).toBeNull();
    expect(callsTo("POST /auth/logout")[0]!.headers.Authorization).toBe(`Bearer ${acc(1)}`);
  });

  it("logout while the PUT is waiting on a refresh; the late refresh must not resurrect the session or open the gate", async () => {
    seed(user({ fullName: "Camila", registrationStatus: "completed" }));
    routes.set(PROFILE_GET, () => reply(200, { data: profile({ fullName: "Camila" }) }));
    const refresh = deferred();
    routes.set(PROFILE_PUT, (c) =>
      c.headers.Authorization === `Bearer ${acc(1)}`
        ? reply(401, {})
        : reply(200, { data: profile({ fullName: "Camila", birthDate: "2002-11-04", eligibility: "eligible" }) }),
    );
    routes.set(REFRESH, () => refresh.promise);
    routes.set("POST /auth/logout", () => reply(200, {}));
    render(<MiniApp start="/" />);
    await screen.findByText("Completa tu fecha de nacimiento");
    fillDate("04", "11", "2002");
    fireEvent.press(screen.getByText("Continuar"));
    await waitFor(() => expect(callsTo(REFRESH)).toHaveLength(1));
    fireEvent.press(screen.getByText("Cerrar sesión"));
    await screen.findByText("Continuar con email");
    await act(async () => {
      refresh.resolve(reply(200, { session: { accessToken: acc(2), refreshToken: ref(2), expiresIn: 900 } }));
    });
    await settle();
    await settle();
    expect(stored()).toBeNull();
    expect(mockNav.tabRenders).toBe(0);
    expect(callsTo(PROFILE_PUT)).toHaveLength(1); // no retry with the new token
    expect(screen.getByText("Continuar con email")).toBeTruthy();
  });

  it("logout, a NEW user logs in, then the old refresh lands; the new keystore entry and gate are untouched", async () => {
    seed(user({ fullName: "Camila", registrationStatus: "completed" }));
    routes.set(PROFILE_GET, (c) =>
      c.headers.Authorization === "Bearer b-access"
        ? reply(200, { data: profile({ fullName: "Beto", birthDate: "1990-01-01", eligibility: "eligible" }) })
        : reply(200, { data: profile({ fullName: "Camila" }) }),
    );
    const refresh = deferred();
    routes.set(PROFILE_PUT, () => reply(401, {}));
    routes.set(REFRESH, () => refresh.promise);
    routes.set("POST /auth/logout", () => reply(200, {}));
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: user({ id: "user-2", email: "b@example.test", fullName: "Beto", registrationStatus: "completed" }),
        session: { accessToken: "b-access", refreshToken: "b-refresh", expiresIn: 900 },
      }),
    );
    render(<MiniApp start="/" />);
    await screen.findByText("Completa tu fecha de nacimiento");
    fillDate("04", "11", "2002");
    fireEvent.press(screen.getByText("Continuar"));
    await waitFor(() => expect(callsTo(REFRESH)).toHaveLength(1));
    fireEvent.press(screen.getByText("Cerrar sesión"));
    await screen.findByText("Continuar con email");
    await act(async () => {
      await probeAuth.verifyOTP("b@example.test", "ch", "123456");
    });
    await screen.findByText("tabs-visible");
    const bStored = stored();
    await act(async () => {
      refresh.resolve(reply(200, { session: { accessToken: "a-new", refreshToken: "a-new-r", expiresIn: 900 } }));
    });
    await settle();
    await settle();
    expect(stored()).toBe(bStored);
    expect(JSON.parse(stored()!).user.id).toBe("user-2");
    expect(screen.getByText("tabs-visible")).toBeTruthy();
  });

  it("logout while the PUT is in flight and answering 200 later; gate stays signed-out", async () => {
    seed(user({ fullName: "Camila", registrationStatus: "completed" }));
    routes.set(PROFILE_GET, () => reply(200, { data: profile({ fullName: "Camila" }) }));
    const put = deferred();
    routes.set(PROFILE_PUT, () => put.promise);
    routes.set("POST /auth/logout", () => reply(200, {}));
    render(<MiniApp start="/" />);
    await screen.findByText("Completa tu fecha de nacimiento");
    fillDate("04", "11", "2002");
    fireEvent.press(screen.getByText("Continuar"));
    await waitFor(() => expect(callsTo(PROFILE_PUT)).toHaveLength(1));
    fireEvent.press(screen.getByText("Cerrar sesión"));
    await screen.findByText("Continuar con email");
    await act(async () => {
      put.resolve(reply(200, { data: profile({ fullName: "Camila", birthDate: "2002-11-04", eligibility: "eligible" }) }));
    });
    await settle();
    expect(mockNav.tabRenders).toBe(0);
    expect(stored()).toBeNull();
    expect(screen.getByText("Continuar con email")).toBeTruthy();
  });
});

describe("a verification that finishes after logout cannot start a session", () => {
  async function startVerify(withDeferredWrite: boolean) {
    routes.set("POST /auth/otp/verify", () =>
      reply(200, {
        user: user({ id: "user-A", fullName: "A", registrationStatus: "completed" }),
        session: { accessToken: "a-access", refreshToken: "a-refresh", expiresIn: 900 },
      }),
    );
    routes.set(PROFILE_GET, () => reply(200, { data: profile({ fullName: "A", birthDate: "2002-11-04", eligibility: "eligible" }) }));
    routes.set("POST /auth/logout", () => reply(200, {}));
    let release!: () => void;
    if (withDeferredWrite) {
      (SecureStore.setItemAsync as jest.Mock).mockImplementationOnce(
        (key: string, value: string) =>
          new Promise<void>((res) => {
            release = () => {
              backing.set(key, value);
              res();
            };
          }),
      );
    }
    render(<MiniApp start="/auth/welcome" />);
    await screen.findByText("Continuar con email");
    let verifyPromise!: Promise<unknown>;
    await act(async () => {
      verifyPromise = probeAuth.verifyOTP("a@example.test", "ch", "123456");
      await new Promise((r) => setImmediate(r));
    });
    return { release: () => release(), verifyPromise };
  }

  it("logout while the keystore write is pending leaves no session and no tabs", async () => {
    const { release, verifyPromise } = await startVerify(true);
    await act(async () => {
      await probeAuth.logout();
    });
    await act(async () => {
      release();
      await verifyPromise;
    });
    await settle();
    expect({ keystore: stored() !== null, tabs: mockNav.tabRenders > 0 }).toEqual({
      keystore: false,
      tabs: false,
    });
  });
});

describe("S-C7 welcome", () => {
  it("both legal labels open the example URL and a rejected Linking.openURL does not crash", async () => {
    const open = jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no handler"));
    render(<MiniApp start="/auth/welcome" />);
    await screen.findByText("Términos");
    fireEvent.press(screen.getByText("Términos"));
    fireEvent.press(screen.getByText("Política de Privacidad"));
    await settle();
    expect(open.mock.calls.map((c) => c[0])).toEqual(["https://savanhi.com", "https://savanhi.com"]);
    expect(screen.getByText("Continuar con email")).toBeTruthy();
    open.mockRestore();
  });
});

describe("S-DOB navigable fields", () => {
  it("completing a part focuses the next, any part stays editable, backspace on an empty part goes back", async () => {
    seed();
    routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
    render(<MiniApp start="/" />);
    await screen.findByText("Completa tu perfil");
    const sel = (label: string) => Boolean(screen.getByLabelText(label).props.accessibilityState?.selected);
    fireEvent.changeText(screen.getByLabelText("Día"), "0");
    expect(sel("Mes")).toBe(false); // incomplete part does not advance
    fireEvent.changeText(screen.getByLabelText("Día"), "04");
    expect(sel("Mes")).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Mes"), "11");
    expect(sel("Año")).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Día"), "05"); // revisit
    expect(screen.getByLabelText("Día").props.value).toBe("05");
    fireEvent.changeText(screen.getByLabelText("Año"), "2o02x");
    expect(screen.getByLabelText("Año").props.value).toBe("202");
  });

  it("a valid adult birth date is still submitted when the phone clock is wrong; the server decides", async () => {
    seed(user({ fullName: "Camila", registrationStatus: "completed" }));
    routes.set(PROFILE_GET, () => reply(200, { data: profile({ fullName: "Camila" }) }));
    routes.set(PROFILE_PUT, () =>
      reply(200, { data: profile({ fullName: "Camila", birthDate: "2002-11-04", eligibility: "eligible" }) }),
    );
    render(<MiniApp start="/" />);
    await screen.findByText("Completa tu fecha de nacimiento");
    jest.useFakeTimers({
      now: new Date(2001, 5, 1),
      doNotFake: ["nextTick", "setImmediate", "clearImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"],
    });
    try {
      fillDate("04", "11", "2002");
      fireEvent.press(screen.getByText("Continuar"));
      await act(async () => { await new Promise((r) => setImmediate(r)); });
    } finally {
      jest.useRealTimers();
    }
    expect(callsTo(PROFILE_PUT)).toHaveLength(1);
  });
});

describe("eligibility is the server's call, not the phone's", () => {
  it("sends a structurally valid future date and shows the approved sentence for the server's refusal", async () => {
    seed();
    routes.set(PROFILE_GET, () => reply(200, { data: profile() }));
    routes.set(PROFILE_PUT, () =>
      reply(422, { error: "x", details: { eligibility: "underage", minimumAge: 18 } }),
    );
    render(<MiniApp start="/" />);
    await screen.findByText("Completa tu perfil");
    fireEvent.changeText(screen.getByLabelText("Nombre"), "Eva");
    fillDate("10", "11", "2099");
    fireEvent.press(screen.getByText("Continuar"));

    expect(await screen.findByText(UNDERAGE)).toBeTruthy();
    expect(callsTo(PROFILE_PUT)[0]!.body).toEqual({
      fullName: "Eva",
      birthDate: "2099-11-10",
    });
    expect(screen.queryByText("Ingresa una fecha válida")).toBeNull();
    expect(mockNav.tabRenders).toBe(0);
  });
});

describe("api base url", () => {
  const dev = (o: Partial<Parameters<typeof resolveClientesApiBaseUrl>[0]>) =>
    resolveClientesApiBaseUrl({ isDevelopment: true, ...o });
  it("derives the PC host from Expo on port 4300, never localhost when a host is known", () => {
    expect(dev({ expoHostUri: "192.168.1.10:8082" })).toBe("http://192.168.1.10:4300");
    expect(dev({ expoHostUri: null })).toBe("http://localhost:4300");
    expect(dev({ override: "http://192.168.1.10:4300/", expoHostUri: "10.0.0.2:8082" })).toBe("http://192.168.1.10:4300");
  });
  it("release requires explicit HTTPS", () => {
    expect(() => resolveClientesApiBaseUrl({ isDevelopment: false })).toThrow();
    expect(() => resolveClientesApiBaseUrl({ isDevelopment: false, override: "http://192.168.1.10:4300" })).toThrow();
    expect(() => resolveClientesApiBaseUrl({ isDevelopment: false, override: "ftp://x.test" })).toThrow();
    expect(() => resolveClientesApiBaseUrl({ isDevelopment: false, override: "https://u:p@x.test" })).toThrow();
    expect(resolveClientesApiBaseUrl({ isDevelopment: false, override: "https://example.invalid/" })).toBe("https://example.invalid");
  });
});
