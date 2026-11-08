# Savanhi Clientes (Android)

The customer app of the Savanhi cuponera. React Native + Expo (same SDK family as `apps/Tenderos/mobile`), Android only.

Today it is a **navigation shell behind a customer login and profile gate**: a floating bar with Inicio, Mapa, Billetera and Perfil, one titled screen per destination, and email-code sign-in. There is no feed, map, QR or permission request yet; those arrive with later units of `odd/tasks/clientes-app.md`.

## Quick path

1. `pnpm install` at the repository root.
2. `pnpm dev` at the root starts the backend and both Expo apps, or `pnpm --filter clientes-mobile dev` starts only this one.
3. Open the development build of Savanhi Clientes on an Android device on the same network.

## Details

| Topic          | Decision                                                             |
| -------------- | -------------------------------------------------------------------- |
| Package        | `clientes-mobile` (technical name); display name `Savanhi Clientes`  |
| Metro port     | `8083` (Tenderos uses `8082`)                                        |
| Mode           | Expo dev client (`expo start --dev-client --lan`), like Tenderos     |
| Android id     | `com.savanhi.clientes`                                               |
| Permissions    | none requested                                                       |
| Sign-in        | email code (OTP) only; verification always sends `registrationRole: "client"` |
| Profile gate   | no tab opens until the server reports the customer `eligible` (18+) AND a name exists |
| Session        | `expo-secure-store` under the key `savanhi-clientes-session` (never the Tenderos key) |
| Native folders | `android/` and `ios/` are generated on demand and git-ignored        |
| Tenderos       | no file under `apps/Tenderos/mobile/**` is read at runtime or edited |

## Sign-in and profile gate

| Case                                   | What the customer sees                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| No session                             | Welcome (email only, no Google), then email, then the 6-digit code                     |
| New customer                           | «Completa tu perfil»: name, optional surname, birth date (day / month / year)          |
| Account with a saved name, no birth date | «Completa tu fecha de nacimiento»: only the birth date; the saved name is kept as is |
| Under 18 (server decides)              | «Debes tener al menos 18 años para usar Savanhi»; correct the date or sign out        |
| Profile cannot be loaded               | «No pudimos cargar tu perfil. Intenta de nuevo» with «Reintentar» and «Cerrar sesión»  |
| Account is not a customer (for example a tendero) | «Esta cuenta no es de cliente» with «Cerrar sesión»                         |

The customer's name and optional surname are sent as one `fullName` (there is no surname column). The birth date is handled as a date-only `YYYY-MM-DD` string and never through `Date`. The app only checks that the three parts form a real calendar date; the phone clock is never consulted, so the 18+ rule, a future date and the 29 February rule are all the server's decision, evaluated on the `America/Bogota` day.

**Legal links are placeholders.** «Términos» and «Política de Privacidad» on the welcome screen both open `https://savanhi.com` as an example. They are not approved legal documents; real destinations must replace them before production.

## API address

| Build       | Address                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Development | Derived from the Expo dev server host on port `4300`, so a phone on the LAN reaches your PC. Override with `EXPO_PUBLIC_CLIENTES_API_URL` (a LAN address such as `http://192.168.1.10:4300`, never `localhost` on a phone). |
| Release     | `EXPO_PUBLIC_CLIENTES_API_URL` is required and must use HTTPS.                                                                           |

See `.env.example`. `expo-secure-store` keeps the session; its config plugin only excludes those entries from Android Auto Backup (its Face ID text is iOS-only and no biometric option is used), so no Android permission is added.

## Root `pnpm dev` and environment

The root command runs Turbo in its default **strict** env mode. Where the backend gets its variables decides whether anything extra is needed:

| Source                                    | Behavior                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root `.env` file (copy of `.env.example`) | Works as is. The backend reads `.env` files itself, after Turbo starts it.                                                                                                                                                                                                     |
| Variables exported in the shell or CI     | Only names listed in `turbo.json` (`tasks.dev.env`) reach the tasks. That list holds `DATABASE_URL`, `AUTH_JWT_SECRET` and the five required `GARAGE_*` names. Optional backend variables (for example `GARAGE_PUBLIC_BASE_URL` or `RATE_LIMIT_*`) must go in the `.env` file. |

The backend refuses to boot without `DATABASE_URL`, `AUTH_JWT_SECRET` and the five `GARAGE_*` variables. This package reads only the public `EXPO_PUBLIC_CLIENTES_API_URL` (see above).

## Verified so far

| Check                            | Result                                                    |
| -------------------------------- | --------------------------------------------------------- |
| `expo export --platform android` | Bundles to Hermes bytecode (4.05 MB) with the sign-in code |
| Jest (`jest-expo`)               | 167 tests: 19 shell tests plus 148 for sign-in and the gate; every call is mocked, no real server or database |
| Root `pnpm dev`                  | Backend plus both Metro servers answer, no port collision |
| Device or emulator, APK build    | **Not verified**; no visual or real OTP-to-gate run has happened |

## Commands

| Command                                     | Purpose            |
| ------------------------------------------- | ------------------ |
| `pnpm --filter clientes-mobile test`        | Jest (`jest-expo`) |
| `pnpm --filter clientes-mobile check-types` | `tsc --noEmit`     |

## Next step

Discovery (T2d) and the wallet (T2e) build on the open gate; the login, session and profile code lives in `src/features/auth`.
