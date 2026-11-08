# Savanhi Clientes (Android)

The customer app of the Savanhi cuponera. React Native + Expo (same SDK family as `apps/Tenderos/mobile`), Android only.

Today it is a **navigation shell behind a customer login and profile gate**, with a working **Inicio**: a floating bar with Inicio, Mapa, Billetera and Perfil, email-code sign-in, and an Inicio that shows the customer's real coupons and lets them follow and unfollow stores. Mapa, Billetera and Perfil are still titled placeholders, and there is no map, QR, claim or permission request yet; those arrive with later units of `odd/tasks/clientes-app.md`.

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
| Permissions    | none requested (Inicio never asks for location)                      |
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

## Inicio: the feed and following

Inicio reads `GET /api/v1/clientes/coupons/feed` with **no query at all**: this version never asks for the phone's location and sends neither `lat` nor `lng`, so the server answers with the coupons of the stores the customer follows (`distanceMeters` is `null`). Nearby coupons join the same single feed once Mapa can supply a position (a later unit); there is no second feed, tab or filter.

| Case                                        | What the customer sees                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Loading                                     | «Cargando cupones…»                                                                          |
| Coupons                                     | One card per server item, in the server's order: title, benefit (`15%`, `$0.50` or the free text), description, validity as a date range (`1 nov 2026 – 25 nov 2026`), store name, address and «Sin distancia» / «A {x} m» / «A {x} km» |
| Follows no store                            | «Aún no sigues ninguna tienda. Abre el Mapa para encontrar tiendas cercanas»                  |
| Follows stores, none has a claimable coupon | «No hay cupones disponibles por ahora»                                                       |
| Feed cannot be read                         | «No pudimos cargar los cupones. Intenta de nuevo» with «Reintentar»; data already on screen stays |
| Followed list cannot be read (empty feed)   | «No pudimos cargar las tiendas. Intenta de nuevo» with «Reintentar»                          |

The followed-stores list (`GET /stores/followed`) is read **only when the feed is empty**, to choose between the two empty states.

**Following.** Each card shows «Siguiendo» and «Dejar de seguir» for a followed store, or «Seguir» otherwise. The control changes only after the server confirms (`PUT`/`DELETE /stores/:storeId/follow` answer the end state), and then it changes on every card of that store. After a confirmed change the feed is read again, so an unfollowed store's coupons disappear from authoritative data. A failed action keeps the previous state and shows «No pudimos actualizar el seguimiento. Intenta de nuevo». Taps on one store are coalesced into one request while it is pending.

| Rule                  | Behavior                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Claiming              | **Not available yet.** There is no «Reclamar», QR or wallet action; `claimed` only means the customer already took the coupon |
| Display               | No id, hour or minute is rendered; dates are date-only and are never turned into a `Date`, so no timezone can move a day    |
| Storage               | The feed lives in memory only. Nothing but the session is persisted, and image URLs are never stored or rendered           |
| Server text           | Never shown. `400`, `429`, `502` and offline all use the fixed Spanish above                                               |

**Session behavior.** Every request goes through the same protected-request path as the profile calls (`runProtected` in the auth layer), so refresh, single-flight and the generation checks are unchanged. A `401` refreshes once and retries; a terminal `401` clears the session. A `403` re-reads the server profile at once and the gate decides (under 18, birth date missing, or not a customer), so the tabs close instead of showing a feed error. If that re-read calls the customer eligible and named after all (for example a proxy that refuses only the feed), the app does not reopen the tabs on its own, because that would repeat the refused request forever: it stops on the profile error («No pudimos cargar tu perfil. Intenta de nuevo») and only «Reintentar» tries again, one bounded cycle per tap. An answer that arrives after logout or under a newer login is dropped. No request is made unless the profile gate is open.

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
| `expo export --platform android` | Bundles to Hermes bytecode (4.07 MB) with the sign-in and Inicio code |
| Jest (`jest-expo`)               | 246 tests: 167 for the shell, sign-in and the gate plus 79 for Inicio, the discovery calls, the protected-request seam and public end-to-end flows; every call is mocked, no real server or database |
| Root `pnpm dev`                  | Backend plus both Metro servers answer, no port collision |
| Device or emulator, APK build    | **Not verified**; no visual or real OTP-to-gate run has happened |

## Commands

| Command                                     | Purpose            |
| ------------------------------------------- | ------------------ |
| `pnpm --filter clientes-mobile test`        | Jest (`jest-expo`) |
| `pnpm --filter clientes-mobile check-types` | `tsc --noEmit`     |

## Next step

The native Mapa with foreground location (T2d.B) comes next and will reuse the protected-request path of Inicio; the wallet and claiming (T2e) follow. Login, session and profile code lives in `src/features/auth`; the feed and following live in `src/features/discovery`.
