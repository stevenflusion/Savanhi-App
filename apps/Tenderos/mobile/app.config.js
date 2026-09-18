require("dotenv").config();

module.exports = {
  expo: {
    name: "Savanhi Tenderos",
    slug: "tenderos-mobile",
    version: "1.0.0",
    platforms: ["android"],
    extra: {
      MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN ?? "",
    },
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    scheme: "tenderosmobile",
    plugins: [
      [
        "@rnmapbox/maps",
        {
          RNMapboxMapsVersion: "11.20.1",
        },
      ],
      "expo-router",
      "expo-font",
    ],
    updates: {
      enabled: false,
      checkAutomatically: "ON_ERROR_RECOVERY",
      fallbackToCacheTimeout: 0,
    },
    experiments: {
      typedRoutes: true,
    },
    icon: "./assets/images/logo.png",
    android: {
      package: "com.anonymous.tenderosmobile",
      adaptiveIcon: {
        foregroundImage: "./assets/images/logo.png",
        backgroundColor: "#ffffff",
      },
    },
  },
};
