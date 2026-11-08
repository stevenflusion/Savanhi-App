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
    },
    // Only the two FOREGROUND location permissions are requested, and only
    // when Mapa opens (C10). Nothing runs in the background and no camera,
    // notification or storage permission exists.
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
    },
  },
};
