# Android APK builds (GitHub Actions)

Workflow: `.github/workflows/android-apk.yml`. It is manual: open **Actions →
Android APK → Run workflow**, choose the branch in "Use workflow from", then the
app (`both`, `clientes` or `tenderos`).

Each build is published to a rolling pre-release, replaced on every run:

- `clientes-latest` → `savanhi-clientes.apk`
- `tenderos-latest` → `savanhi-tenderos.apk`

The repository is private, so downloading needs a GitHub account with access.
The APK is also kept as a run artifact for 14 days.

## One-time setup

### 1. Release keystore (never commit it)

Keep the file and its passwords somewhere safe. If you lose it, installed apps
can no longer be updated, only reinstalled.

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore savanhi-release.keystore \
  -alias savanhi -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 savanhi-release.keystore   # value for ANDROID_KEYSTORE_BASE64
```

One keystore can sign both apps.

### 2. Repository secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of the keystore |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `savanhi` (or the alias you chose) |
| `ANDROID_KEY_PASSWORD` | key password |
| `MAPBOX_ACCESS_TOKEN` | public `pk.` Mapbox token |
| `CLIENTES_GOOGLE_SERVICES_BASE64` | optional: base64 of Clientes' `google-services.json`. Without it the coupon reminder opt-in stays hidden |

### 3. Repository variables (same page, "Variables" tab)

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_CLIENTES_API_URL` | required, `https://` backend URL for Clientes |
| `EXPO_PUBLIC_TENDEROS_API_URL` | backend URL for Tenderos |
| `CLIENTES_EAS_PROJECT_ID` | optional, Expo project id for push tokens |

## Notes

- The native project is regenerated on the runner (`expo prebuild --clean`);
  nothing is written back to the repository.
- `versionCode` is the run number, so each APK installs over the previous one.
- Only `arm64-v8a` is built by default (smaller and faster). Change the `abis`
  input to add `armeabi-v7a`, `x86_64`, etc.
- The Tenderos package is still `com.anonymous.tenderosmobile`, the Expo
  default. Change it before the first real release: it cannot change later.
