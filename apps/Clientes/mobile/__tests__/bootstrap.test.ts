import fs from "node:fs";
import path from "node:path";

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "../../..");

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function expoPort(devScript: string): string | undefined {
  return /--port\s+(\d+)/.exec(devScript)?.[1];
}

function loadExpoConfig() {
  // The config module reads process.env at load time, so each load is fresh.
  jest.resetModules();
  return require("../app.config.js").expo;
}

describe("Savanhi Clientes bootstrap", () => {
  describe("Expo app identity (C6)", () => {
    it("is named Savanhi Clientes and targets Android only", () => {
      const config = loadExpoConfig();

      expect(config.name).toBe("Savanhi Clientes");
      expect(config.platforms).toEqual(["android"]);
      expect(config.android.package).toBe("com.savanhi.clientes");
      expect(config.ios).toBeUndefined();
    });

    it("has its own slug and URL scheme, distinct from Tenderos", () => {
      const clientes = loadExpoConfig();
      const tenderos = require("../../../Tenderos/mobile/app.config.js").expo;

      expect(clientes.slug).toBe("clientes-mobile");
      expect(clientes.scheme).toBe("savanhiclientes");
      expect(clientes.slug).not.toBe(tenderos.slug);
      expect(clientes.scheme).not.toBe(tenderos.scheme);
      expect(clientes.android.package).not.toBe(tenderos.android.package);
    });

    it("requests no runtime permission and registers no permission plugin", () => {
      const config = loadExpoConfig();
      const pluginNames = (config.plugins ?? []).map((plugin: unknown) =>
        Array.isArray(plugin) ? plugin[0] : plugin,
      );

      expect(config.android.permissions ?? []).toEqual([]);
      // `expo-secure-store` stores the session; it declares no permission on
      // Android and no camera, location or notification plugin exists.
      expect(pluginNames).toEqual(["expo-router", "expo-secure-store"]);
    });

    it("declares no deep link or universal link for coupons (C5)", () => {
      const config = loadExpoConfig();

      expect(config.android.intentFilters).toBeUndefined();
      expect(config.ios).toBeUndefined();
    });
  });

  describe("package and Expo dev port (C6)", () => {
    it("uses the technical package name clientes-mobile with the Expo Router entry", () => {
      const pkg = readJson(path.join(packageRoot, "package.json"));

      expect(pkg.name).toBe("clientes-mobile");
      expect(pkg.main).toBe("expo-router/entry");
    });

    it("exposes the same script names the root tasks run", () => {
      const pkg = readJson(path.join(packageRoot, "package.json"));

      expect(Object.keys(pkg.scripts)).toEqual(
        expect.arrayContaining(["dev", "test", "check-types"]),
      );
    });

    it("serves Metro on a port that does not collide with Tenderos", () => {
      const clientes = readJson(path.join(packageRoot, "package.json"));
      const tenderos = readJson(
        path.join(repoRoot, "apps/Tenderos/mobile/package.json"),
      );

      expect(expoPort(tenderos.scripts.dev)).toBe("8082");
      expect(expoPort(clientes.scripts.dev)).toBe("8083");
    });

    it("imports no Tenderos path and adds no map, camera or location SDK", () => {
      const pkg = readJson(path.join(packageRoot, "package.json"));
      const dependencies = Object.keys(pkg.dependencies);

      expect(dependencies).not.toEqual(
        expect.arrayContaining(["@rnmapbox/maps"]),
      );
      expect(dependencies).not.toEqual(expect.arrayContaining(["expo-camera"]));
      expect(dependencies).not.toEqual(
        expect.arrayContaining(["expo-location"]),
      );
      expect(JSON.stringify(pkg)).not.toMatch(/tenderos/i);
    });
  });

  describe("root pnpm dev (C6)", () => {
    const rootScripts = () =>
      readJson(path.join(repoRoot, "package.json")).scripts;

    it("starts the backend and both mobile packages", () => {
      const dev: string = rootScripts().dev;

      expect(dev).toMatch(/^turbo run dev\b/);
      expect(dev).toContain("--filter=tenderos-backend");
      expect(dev).toContain("--filter=tenderos-mobile");
      expect(dev).toContain("--filter=clientes-mobile");
    });

    it("lets exported backend variables through Turbo's strict env mode", () => {
      const turbo = readJson(path.join(repoRoot, "turbo.json"));
      const devEnv: string[] = turbo.tasks.dev.env;

      // Names only, never values. The backend refuses to boot without these,
      // and a variable exported in the shell is dropped by strict mode unless
      // it is listed here (values read from a .env file are not affected).
      expect(devEnv).toEqual(
        expect.arrayContaining([
          "DATABASE_URL",
          "AUTH_JWT_SECRET",
          "GARAGE_ENDPOINT",
          "GARAGE_REGION",
          "GARAGE_BUCKET",
          "GARAGE_ACCESS_KEY_ID",
          "GARAGE_SECRET_ACCESS_KEY",
          "EXPO_PUBLIC_TENDEROS_API_URL",
          "EXPO_PUBLIC_CLIENTES_API_URL",
        ]),
      );
    });

    it("keeps Turbo's strict env mode instead of a blanket loose mode", () => {
      const rootPackage = readJson(path.join(repoRoot, "package.json"));
      const turbo = readJson(path.join(repoRoot, "turbo.json"));

      expect(rootPackage.scripts.dev).not.toMatch(/env-mode/);
      expect(turbo.envMode).toBeUndefined();
    });

    it("leaves the other root scripts as they were", () => {
      const scripts = rootScripts();

      expect(scripts.build).toBe("turbo run build");
      expect(scripts.test).toBe(
        "turbo run test:auth --filter=@repo/backend-core --filter=tenderos-mobile",
      );
      expect(scripts["check-types"]).toBe("turbo run check-types");
    });

    it("keeps the Tenderos dev script untouched", () => {
      const tenderos = readJson(
        path.join(repoRoot, "apps/Tenderos/mobile/package.json"),
      );

      expect(tenderos.scripts.dev).toBe(
        "expo start --dev-client --lan --port 8082 --clear",
      );
    });
  });
});
