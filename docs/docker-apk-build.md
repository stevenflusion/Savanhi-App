# Local preview APK build

This repository can run an EAS local Android build in the `Savanhi-apk` Docker
container. The image provides Java 17, Android API 35/build-tools 35.0.0, Node
22, pnpm 11.7.0, and a pinned EAS CLI version.

From the repository root, keep `EXPO_TOKEN` and `MAPBOX_ACCESS_TOKEN` in the
ignored root `.env` file. Docker Compose loads that file automatically for
interpolation. Provide only the release API URL in the shell and run:

```sh
export EXPO_PUBLIC_TENDEROS_API_URL=https://api.example.com
docker compose -f docker-compose.apk.yml build
docker compose -f docker-compose.apk.yml run --rm apk
```

The APK is written to `artifacts/tenderos-preview.apk`. Environment variables
are passed at runtime and are not baked into the image. Dependencies are
installed from the monorepo root so workspace packages resolve correctly.

`EXPO_TOKEN` is required because the build runs non-interactively. Create a
token in Expo account settings and keep it, together with
`MAPBOX_ACCESS_TOKEN`, in the root `.env`; do not commit that file. The root
`.env` is ignored by Git.

The preview profile sets `NODE_ENV=production` and limits this local APK to
`arm64-v8a` to reduce native compile memory. It does not change the default
architectures used by other Android builds, but x86/x86_64 emulators cannot
install this preview APK; use a physical ARM64 device or override the
Compose-scoped Gradle property when an emulator build is needed.

The preview profile intentionally does not introduce production credentials.
The generated release APK therefore uses the signing configuration already
present in `android/app/build.gradle` (currently the debug signing config).
Production signing should be added separately before distribution.
