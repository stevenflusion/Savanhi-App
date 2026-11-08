import { createAuthFetchRepository } from "@/src/features/auth/infrastructure/auth-fetch-repository";

const BASE = "https://api.example.test";

type FakeResponse = {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
};

const response = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name] ?? null },
  json: async () => body,
});

const fetchMock = jest.fn();
const repository = () => createAuthFetchRepository({ getBaseUrl: () => BASE });

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url: url as string,
    init: init as RequestInit & { headers: Record<string, string> },
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  };
};

beforeEach(() => {
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

describe("OTP requests (C7)", () => {
  it("posts only the email and returns the challenge", async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, { challengeId: "challenge-1", cooldownSeconds: 30 }),
    );

    const result = await repository().requestOtp("cliente@example.test");

    expect(lastCall().url).toBe(`${BASE}/auth/otp/request`);
    expect(lastCall().body).toEqual({ email: "cliente@example.test" });
    expect(result).toEqual({
      success: true,
      state: "sent",
      challengeId: "challenge-1",
      cooldownSeconds: 30,
    });
  });

  it("classifies a rate limit and keeps Retry-After", async () => {
    fetchMock.mockResolvedValueOnce(
      response(429, { error: "slow down", code: "rate_limited" }, {
        "Retry-After": "42",
      }),
    );

    expect(await repository().requestOtp("a@b.co")).toMatchObject({
      success: false,
      state: "rate_limited",
      retryAfterSeconds: 42,
    });
  });

  it("reports offline with neutral Spanish and no server text", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.9"));

    const result = await repository().requestOtp("a@b.co");

    expect(result).toMatchObject({ success: false, state: "offline" });
    const text = (result as { error: string }).error;
    expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.9/);
    expect(text).not.toMatch(/Probá|Revisá|Intentá/);
  });
});

describe("OTP verification (C1, C7)", () => {
  it("always asks for the client role and sends nothing else", async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        user: { id: "u1", role: "client" },
        session: { accessToken: "a", refreshToken: "r", expiresIn: 900 },
      }),
    );

    const result = await repository().verifyOtp(
      "cliente@example.test",
      "challenge-1",
      "123456",
    );

    expect(lastCall().url).toBe(`${BASE}/auth/otp/verify`);
    expect(lastCall().body).toEqual({
      email: "cliente@example.test",
      challengeId: "challenge-1",
      token: "123456",
      registrationRole: "client",
    });
    expect(result).toMatchObject({
      success: true,
      user: { role: "client" },
      session: { accessToken: "a" },
    });
  });

  it("classifies wrong, expired and offline outcomes without echoing the server", async () => {
    fetchMock.mockResolvedValueOnce(
      response(401, { error: "secret-detail", code: "incorrect_code" }),
    );
    const wrong = await repository().verifyOtp("a@b.co", "c", "000000");
    expect(wrong).toMatchObject({ success: false, state: "incorrect_code" });

    fetchMock.mockResolvedValueOnce(
      response(401, { error: "secret-detail", code: "expired_code" }),
    );
    expect(await repository().verifyOtp("a@b.co", "c", "000000")).toMatchObject(
      { success: false, state: "expired_code" },
    );

    fetchMock.mockRejectedValueOnce(new Error("secret-detail"));
    const offline = await repository().verifyOtp("a@b.co", "c", "000000");
    expect(offline).toMatchObject({ success: false, state: "offline" });

    for (const failure of [wrong, offline]) {
      expect(JSON.stringify(failure)).not.toContain("secret-detail");
    }
  });

  it("never logs the code or the tokens", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (method) => jest.spyOn(console, method).mockImplementation(() => {}),
    );
    fetchMock.mockResolvedValueOnce(
      response(200, {
        user: { id: "u1", role: "client" },
        session: { accessToken: "ACCESS-X", refreshToken: "REFRESH-X" },
      }),
    );

    await repository().verifyOtp("a@b.co", "c", "987654");

    for (const spy of spies) {
      const printed = JSON.stringify(spy.mock.calls);
      expect(printed).not.toMatch(/987654|ACCESS-X|REFRESH-X/);
      spy.mockRestore();
    }
  });
});

describe("refresh (T2c, replay protection)", () => {
  const refreshBody = {
    session: { accessToken: "a2", refreshToken: "r2", expiresIn: 900 },
  };

  it("classifies 400 and 401 as terminal, anything else as transient", async () => {
    fetchMock.mockResolvedValueOnce(response(401, {}));
    expect(await repository().refreshSession("terminal-401")).toMatchObject({
      success: false,
      terminal: true,
    });
    fetchMock.mockResolvedValueOnce(response(400, {}));
    expect(await repository().refreshSession("terminal-400")).toMatchObject({
      success: false,
      terminal: true,
    });
    fetchMock.mockResolvedValueOnce(response(503, {}));
    expect(await repository().refreshSession("transient-503")).toMatchObject({
      success: false,
      terminal: false,
    });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await repository().refreshSession("transient-net")).toMatchObject({
      success: false,
      terminal: false,
    });
  });

  it("single-flights concurrent refreshes of one token", async () => {
    let release!: (value: FakeResponse) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<FakeResponse>((resolve) => {
        release = resolve;
      }),
    );

    const first = repository().refreshSession("flight-1");
    const second = repository().refreshSession("flight-1");
    release(response(200, refreshBody));

    expect(await first).toEqual(await second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastCall().body).toEqual({ refreshToken: "flight-1" });
  });

  it("does not mix two different tokens in one flight", async () => {
    fetchMock.mockResolvedValue(response(200, refreshBody));

    await Promise.all([
      repository().refreshSession("mix-a"),
      repository().refreshSession("mix-b"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses a rotation for a minute and then asks again", async () => {
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    fetchMock.mockResolvedValue(response(200, refreshBody));

    await repository().refreshSession("reuse-1");
    await repository().refreshSession("reuse-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + 61_000);
    await repository().refreshSession("reuse-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it("forgets a failed refresh so a later attempt can retry", async () => {
    fetchMock.mockResolvedValueOnce(response(503, {}));
    await repository().refreshSession("retry-1");
    fetchMock.mockResolvedValueOnce(response(200, refreshBody));

    expect(await repository().refreshSession("retry-1")).toMatchObject({
      success: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("current user, profile and logout (C9)", () => {
  it("reads the current user with the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(response(200, { user: { id: "u1" } }));

    const result = await repository().getCurrentUser("tok");

    expect(lastCall().url).toBe(`${BASE}/auth/me`);
    expect(lastCall().init.headers.Authorization).toBe("Bearer tok");
    expect(result).toEqual({ success: true, data: { id: "u1" } });
  });

  it("reads the customer profile from its own route", async () => {
    const profile = {
      fullName: "",
      birthDate: null,
      eligibility: "birth_date_required",
    };
    fetchMock.mockResolvedValueOnce(response(200, { data: profile }));

    const result = await repository().getProfile("tok");

    expect(lastCall().url).toBe(`${BASE}/api/v1/clientes/profile`);
    expect(lastCall().init.method ?? "GET").toBe("GET");
    expect(lastCall().init.headers.Authorization).toBe("Bearer tok");
    expect(result).toEqual({ success: true, data: profile });
  });

  it("marks a 403 without eligibility details as a role problem", async () => {
    fetchMock.mockResolvedValueOnce(
      response(403, { error: "You do not have access to this resource." }),
    );

    expect(await repository().getProfile("tok")).toMatchObject({
      success: false,
      status: 403,
      unauthorized: false,
    });
  });

  it("saves name and birth date together and nothing else", async () => {
    const saved = {
      fullName: "Camila Vega",
      birthDate: "2002-11-04",
      eligibility: "eligible",
    };
    fetchMock.mockResolvedValueOnce(response(200, { data: saved }));

    const result = await repository().saveProfile(
      { fullName: "Camila Vega", birthDate: "2002-11-04" },
      "tok",
    );

    expect(lastCall().url).toBe(`${BASE}/api/v1/clientes/profile`);
    expect(lastCall().init.method).toBe("PUT");
    expect(lastCall().body).toEqual({
      fullName: "Camila Vega",
      birthDate: "2002-11-04",
    });
    expect(result).toEqual({ success: true, data: saved });
  });

  it("surfaces the eligibility code of an underage rejection, not its text", async () => {
    fetchMock.mockResolvedValueOnce(
      response(422, {
        error: "You must be at least 18 years old to use Savanhi.",
        details: { eligibility: "underage", minimumAge: 18 },
      }),
    );

    const result = await repository().saveProfile(
      { fullName: "Camila", birthDate: "2012-01-01" },
      "tok",
    );

    expect(result).toMatchObject({
      success: false,
      status: 422,
      eligibility: "underage",
    });
    expect(JSON.stringify(result)).not.toContain("at least 18 years");
  });

  it("posts the logout with the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(response(200, {}));

    await repository().logout({ accessToken: "tok", refreshToken: "r" });

    expect(lastCall().url).toBe(`${BASE}/auth/logout`);
    expect(lastCall().init.method).toBe("POST");
    expect(lastCall().init.headers.Authorization).toBe("Bearer tok");
  });

  it("turns a bad API address into an offline failure instead of throwing", async () => {
    const broken = createAuthFetchRepository({
      getBaseUrl: () => {
        throw new Error("EXPO_PUBLIC_CLIENTES_API_URL must not be empty.");
      },
    });

    expect(await broken.requestOtp("a@b.co")).toMatchObject({
      success: false,
      state: "offline",
    });
    expect(await broken.getProfile("tok")).toMatchObject({
      success: false,
      unauthorized: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
