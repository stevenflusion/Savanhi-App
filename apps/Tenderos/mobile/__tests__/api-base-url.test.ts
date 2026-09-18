import { resolveTenderosApiBaseUrl } from "@/src/features/auth/infrastructure/api-base-url";

describe("Tenderos API base URL", () => {
  it("prefers the Expo host over a historical development override", () => {
    expect(
      resolveTenderosApiBaseUrl({
        override: "http://192.168.1.10:4300",
        expoHostUri: "192.168.1.25:8082",
        isDevelopment: true,
      }),
    ).toBe("http://192.168.1.25:4300");
  });

  it("derives only the hostname from the Expo host URI", () => {
    expect(
      resolveTenderosApiBaseUrl({
        expoHostUri: "192.168.1.25:8082/some/path",
        isDevelopment: true,
      }),
    ).toBe("http://192.168.1.25:4300");
  });

  it("uses and normalizes the override when development Expo has no host", () => {
    expect(
      resolveTenderosApiBaseUrl({
        override: " https://api.example.test/tenderos/// ",
        isDevelopment: true,
      }),
    ).toBe("https://api.example.test/tenderos");
  });

  it("treats an empty development override as absent", () => {
    expect(
      resolveTenderosApiBaseUrl({ override: "   ", isDevelopment: true }),
    ).toBe("http://localhost:4300");
  });

  it("uses localhost only as a development fallback", () => {
    expect(resolveTenderosApiBaseUrl({ isDevelopment: true })).toBe(
      "http://localhost:4300",
    );
  });

  it("supports a bracketed IPv6 Expo host", () => {
    expect(
      resolveTenderosApiBaseUrl({
        expoHostUri: "[2001:db8::1]:8082",
        isDevelopment: true,
      }),
    ).toBe("http://[2001:db8::1]:4300");
  });

  it("accepts and normalizes an explicit HTTPS release URL", () => {
    expect(
      resolveTenderosApiBaseUrl({
        override: "https://api.example.test///",
        expoHostUri: "192.168.1.25:8082",
        isDevelopment: false,
      }),
    ).toBe("https://api.example.test");
  });

  it.each([undefined, "", "   "])(
    "rejects a release build without an explicit HTTPS URL: %p",
    (override) => {
      expect(() =>
        resolveTenderosApiBaseUrl({ override, isDevelopment: false }),
      ).toThrow(
        "EXPO_PUBLIC_TENDEROS_API_URL is required in release builds and must use HTTPS.",
      );
    },
  );

  it("does not use the Expo host as a release fallback", () => {
    expect(() =>
      resolveTenderosApiBaseUrl({
        expoHostUri: "192.168.1.25:8082",
        isDevelopment: false,
      }),
    ).toThrow(
      "EXPO_PUBLIC_TENDEROS_API_URL is required in release builds and must use HTTPS.",
    );
  });

  it("rejects an HTTP release URL", () => {
    expect(() =>
      resolveTenderosApiBaseUrl({
        override: "http://api.example.test",
        isDevelopment: false,
      }),
    ).toThrow(
      "EXPO_PUBLIC_TENDEROS_API_URL is required in release builds and must use HTTPS.",
    );
  });

  it.each([
    {
      override: "ftp://api.example.test",
      expoHostUri: undefined,
      isDevelopment: true,
    },
    {
      override: undefined,
      expoHostUri: "not a valid host URI",
      isDevelopment: true,
    },
  ])("rejects invalid development input: %o", (options) => {
    expect(() => resolveTenderosApiBaseUrl(options)).toThrow();
  });
});
