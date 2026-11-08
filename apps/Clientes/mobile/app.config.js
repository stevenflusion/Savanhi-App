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
    // The shell requests no runtime permission. Location, camera and any other
    // permission arrive with the feature that needs them (C10).
    plugins: ["expo-router"],
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
