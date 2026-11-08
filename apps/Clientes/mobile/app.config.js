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
    // No runtime permission is requested. Location, camera and any other
    // permission arrive with the feature that needs them (C10).
    // `expo-secure-store` holds the session. Its plugin keeps those entries out
    // of Android Auto Backup (a restored backup cannot decrypt them); the
    // Face ID text it can set applies to iOS only and no biometric option is
    // used, so nothing is added to the Android manifest permissions.
    plugins: [
      "expo-router",
      ["expo-secure-store", { configureAndroidBackup: true }],
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
    },
  },
};
