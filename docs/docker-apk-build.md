# Local preview APK build

This repository can run an EAS local Android build in the `Savanhi-apk` Docker
container. The image provides Java 17, Android API 35/build-tools 35.0.0, Node
22, pnpm 11.7.0, and a pinned EAS CLI version.

From the repository root, provide the release API URL and run:

```sh
export EXPO_TOKEN=your-expo-access-token
export EXPO_PUBLIC_TENDEROS_API_URL=https://api.example.com
export MAPBOX_ACCESS_TOKEN=your-token
docker compose -f docker-compose.apk.yml build
docker compose -f docker-compose.apk.yml run --rm apk
```

The APK is written to `artifacts/tenderos-preview.apk`. Environment variables
are passed at runtime and are not baked into the image. Dependencies are
installed from the monorepo root so workspace packages resolve correctly.

`EXPO_TOKEN` is required because the build runs non-interactively. Create an
access token in Expo account settings and keep it in the shell environment; do
not commit it to the repository.

The preview profile intentionally does not introduce production credentials.
The generated release APK therefore uses the signing configuration already
present in `android/app/build.gradle` (currently the debug signing config).
Production signing should be added separately before distribution.
