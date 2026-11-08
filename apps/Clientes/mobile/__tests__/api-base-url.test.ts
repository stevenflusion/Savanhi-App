import { resolveClientesApiBaseUrl } from "@/src/features/auth/infrastructure/api-base-url";

describe("Clientes API base URL", () => {
  it("prefers an explicit development override over the Expo host", () => {
    expect(
      resolveClientesApiBaseUrl({
        override: "http://192.168.1.10:4300",
        expoHostUri: "192.168.1.25:8083",
        isDevelopment: true,
      }),
    ).toBe("http://192.168.1.10:4300");
  });

  it("derives only the hostname of the PC from the Expo host URI", () => {
    expect(
      resolveClientesApiBaseUrl({
        expoHostUri: "192.168.1.25:8083/some/path",
        isDevelopment: true,
      }),
    ).toBe("http://192.168.1.25:4300");
  });

  it("brackets an IPv6 Expo host", () => {
    expect(
      resolveClientesApiBaseUrl({
        expoHostUri: "[fe80::1]:8083",
        isDevelopment: true,
      }),
    ).toBe("http://[fe80::1]:4300");
  });

  it("normalizes whitespace and trailing slashes", () => {
    expect(
      resolveClientesApiBaseUrl({
        override: " https://api.example.test/clientes/// ",
        isDevelopment: true,
      }),
    ).toBe("https://api.example.test/clientes");
  });

  it("falls back to localhost only when development has no Expo host", () => {
    expect(resolveClientesApiBaseUrl({ isDevelopment: true })).toBe(
      "http://localhost:4300",
    );
  });

  it("requires an HTTPS address in release builds", () => {
    expect(() => resolveClientesApiBaseUrl({ isDevelopment: false })).toThrow(
      "EXPO_PUBLIC_CLIENTES_API_URL is required in release builds and must use HTTPS.",
    );
    expect(() =>
      resolveClientesApiBaseUrl({
        override: "http://api.example.test",
        isDevelopment: false,
      }),
    ).toThrow(/must use HTTPS/);
    expect(
      resolveClientesApiBaseUrl({
        override: "https://api.example.test/api/v1",
        isDevelopment: false,
      }),
    ).toBe("https://api.example.test/api/v1");
  });

  it("rejects malformed overrides with a clear technical message", () => {
    const resolve = (override: string) =>
      resolveClientesApiBaseUrl({ override, isDevelopment: true });

    expect(() => resolve("not a url")).toThrow(
      "EXPO_PUBLIC_CLIENTES_API_URL must be a valid absolute URL.",
    );
    expect(() => resolve("ftp://host")).toThrow(/must use http or https/);
    expect(() => resolve("https://user:pw@host")).toThrow(
      /without credentials/,
    );
    expect(() => resolve("https://host?x=1")).toThrow(
      /must not contain a query or fragment/,
    );
  });

  it("never leaks the rejected value into the message", () => {
    expect(() =>
      resolveClientesApiBaseUrl({
        override: "https://user:supersecret@host",
        isDevelopment: true,
      }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining("supersecret") }));
  });
});
