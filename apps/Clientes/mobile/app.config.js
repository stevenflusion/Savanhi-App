// Optional build inputs for coupon expiry reminders. Names only: the values come
// from the environment (or EAS), never from the repository. When either is
// blank the app builds as before and the reminder opt-in stays hidden.
const envValue = (name) => process.env[name]?.trim() || undefined;
const easProjectId = envValue("CLIENTES_EAS_PROJECT_ID");
// A PATH to the Firebase Android file, which stays outside the repository.
const googleServicesFile = envValue("CLIENTES_GOOGLE_SERVICES_FILE");

module.exports = {
  expo: {
    name: "Savanhi Clientes",
    slug: "clientes-mobile",
    version: "1.0.0",
    // Android only for the first version (C6); no iOS target is claimed.
    platforms: ["android"],
    orientation: "portrait",
    userInterfaceStyle: "light",
    newArchEnabled: true,
    // Required by Expo Router. It is NOT a coupon link: deep links are out of
    // the MVP (C5), so no intent filter is declared.
    scheme: "savanhiclientes",
    // The public Mapbox token is read from the environment (a package `.env`
    // loaded by Expo CLI, or a variable exported in the shell). It is NOT a
    // secret and is never hardcoded; an empty value is a runtime prerequisite
    // the Mapa screen reports instead of drawing a fake map.
    extra: {
      MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN ?? "",
      ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
    },
    // The two FOREGROUND location permissions are requested only when Mapa
    // opens (C10), and the notification permission only after the customer
    // opts in to coupon reminders in Billetera. Nothing runs in the
    // background and no camera or storage permission exists.
    // `expo-secure-store` holds the session. Its plugin keeps those entries out
    // of Android Auto Backup (a restored backup cannot decrypt them); the
    // Face ID text it can set applies to iOS only and no biometric option is
    // used, so nothing is added to the Android manifest permissions.
    plugins: [
      "expo-router",
      ["expo-secure-store", { configureAndroidBackup: true }],
      // The native map. Mapbox no longer requires a downloads token, so none
      // is configured. `expo-location` needs no config plugin: it adds only
      // the permissions declared below and iOS usage text we do not ship.
      ["@rnmapbox/maps", { RNMapboxMapsVersion: "11.20.1" }],
      // Coupon expiry reminders. The plugin adds no scheme or intent filter;
      // the Android channel is created at runtime, after the opt-in.
      "expo-notifications",
    ],
    updates: {
      enabled: false,
      checkAutomatically: "ON_ERROR_RECOVERY",
      fallbackToCacheTimeout: 0,
    },
    experiments: {
      typedRoutes: true,
    },
    android: {
      package: "com.savanhi.clientes",
      permissions: [
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
      ],
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  },
};
