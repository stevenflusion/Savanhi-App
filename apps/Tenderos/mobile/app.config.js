require("dotenv").config();

module.exports = {
  expo: {
    name: "Savanhi Tenderos",
    slug: "tenderos-mobile",
    version: "1.0.0",
    platforms: ["android"],
    extra: {
      MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN ?? "",
      eas: {
        projectId: "d29db747-6120-4d25-ba2f-f9def208d544",
      },
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
      // The coupon scanner (S3, authorized in L6). The permission text is the
      // sentence the tendero reads in the system dialog, so it is Spanish like
      // the rest of the app's copy, and audio is never requested: this camera
      // reads QR codes and records nothing.
      [
        "expo-camera",
        {
          cameraPermission:
            "Savanhi usa la cámara para leer el código QR del cupón de tu cliente.",
          recordAudioAndroid: false,
        },
      ],
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
      // Declared here as well as by the plugin, so the camera permission is
      // readable in the app config itself and not only in a generated
      // manifest (S3).
      permissions: ["android.permission.CAMERA"],
    },
    // The same declaration for the other platform. The app ships Android today
    // (`platforms` above), and the usage description travels with the config so
    // an iOS build never lands without it.
    ios: {
      infoPlist: {
        NSCameraUsageDescription:
          "Savanhi usa la cámara para leer el código QR del cupón de tu cliente.",
      },
    },
  },
};
