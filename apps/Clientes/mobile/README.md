# Savanhi Clientes (Android)

The customer app of the Savanhi cuponera. React Native + Expo (same SDK family as `apps/Tenderos/mobile`), Android only.

Today it is a **navigation shell**: a floating bar with Inicio, Mapa, Billetera and Perfil, and one titled screen per destination. There is no login, API call, map, QR or permission request yet; those arrive with later units of `odd/tasks/clientes-app.md`.

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
| Permissions    | none requested by the shell                                          |
| Native folders | `android/` and `ios/` are generated on demand and git-ignored        |
| Tenderos       | no file under `apps/Tenderos/mobile/**` is read at runtime or edited |

## Root `pnpm dev` and environment

The root command runs Turbo in its default **strict** env mode. Where the backend gets its variables decides whether anything extra is needed:

| Source                                    | Behavior                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root `.env` file (copy of `.env.example`) | Works as is. The backend reads `.env` files itself, after Turbo starts it.                                                                                                                                                                                                     |
| Variables exported in the shell or CI     | Only names listed in `turbo.json` (`tasks.dev.env`) reach the tasks. That list holds `DATABASE_URL`, `AUTH_JWT_SECRET` and the five required `GARAGE_*` names. Optional backend variables (for example `GARAGE_PUBLIC_BASE_URL` or `RATE_LIMIT_*`) must go in the `.env` file. |

The backend refuses to boot without `DATABASE_URL`, `AUTH_JWT_SECRET` and the five `GARAGE_*` variables. This package reads no environment variable yet.

## Verified so far

| Check                            | Result                                                    |
| -------------------------------- | --------------------------------------------------------- |
| `expo export --platform android` | Bundles (1326 modules, Hermes bytecode)                   |
| Root `pnpm dev`                  | Backend plus both Metro servers answer, no port collision |
| Device or emulator, APK build    | **Not verified**; deferred beyond the bootstrap           |

## Commands

| Command                                     | Purpose            |
| ------------------------------------------- | ------------------ |
| `pnpm --filter clientes-mobile test`        | Jest (`jest-expo`) |
| `pnpm --filter clientes-mobile check-types` | `tsc --noEmit`     |

## Next step

Customer login and registration (T2c) reuse the Tenderos design and logic as new files copied into this package.
