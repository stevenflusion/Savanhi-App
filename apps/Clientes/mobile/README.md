# Savanhi Clientes (Android)

The customer app of the Savanhi cuponera. React Native + Expo (same SDK family as `apps/Tenderos/mobile`), Android only.

Today it is a **navigation shell behind a customer login and profile gate**, with a working **Inicio** and a native **Mapa**: a floating bar with Inicio, Mapa, Billetera and Perfil, email-code sign-in, an Inicio that shows the customer's real coupons, and a Mapa of the nearby stores. Both let the customer follow and unfollow stores. Billetera and Perfil are still titled placeholders, and there is no QR or claim yet; those arrive with later units of `odd/tasks/clientes-app.md`.

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
| Permissions    | foreground location only (`ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`), asked only when Mapa opens |
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

Inicio reads `GET /api/v1/clientes/coupons/feed`. **Until Mapa has produced a position it sends no query at all** and never asks for the phone's location: neither `lat` nor `lng` is sent, so the server answers with the coupons of the stores the customer follows (`distanceMeters` is `null`). Once Mapa holds a position, Inicio sends exactly the `lat`/`lng` pair and the same single feed also carries the nearby coupons with their distance; there is no second feed, tab or filter. If the position is lost, Inicio drops the nearby items at once and reads the followed-only feed again.

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

## Mapa: nearby stores and location

Mapa shows a native map (`@rnmapbox/maps`) fixed on the customer's position with one marker per store of `GET /api/v1/clientes/stores/nearby?lat&lng` (the API's 3 km radius), and a card per store with its name, address, distance and the same follow control as Inicio. A store's following state comes from `GET /stores/followed` plus the server-confirmed changes, because the nearby answer carries no such flag.

| Case                                        | What the customer sees                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| First Inicio                                | Nothing location-related: no prompt, no permission, status or position call                                      |
| Mapa opens, permission undetermined         | The system's own foreground prompt, once                                                                        |
| Locating, or reading the stores             | «Buscando tiendas cercanas…»; the map exists only once a real position does                                     |
| Stores found                                | The map with markers and the store cards; none: «No hay tiendas cercanas»                                       |
| Permission denied                           | Only «La ubicación es necesaria para mostrarte tiendas cercanas. Puedes activarla más adelante desde los ajustes de Savanhi en tu teléfono» |
| Position or stores cannot be read           | «No pudimos cargar las tiendas. Intenta de nuevo» with «Reintentar»                                             |
| Build without a Mapbox token                | The same error without a map or retry (a build prerequisite, see below); the store cards still list               |

**Location rules.** The OS is asked only while the permission is still undetermined and only when Mapa gains focus. A denial, including one the OS would let the app repeat, is never followed by a second request, and there is no «Abrir ajustes» button, retry button or pre-permission screen: the customer changes the permission in the phone's settings for Savanhi, outside the app, and the other three tabs keep working. When the app returns to the foreground after Mapa was opened, the permission is read straight away (never requested), even while a position reading is still pending: a later grant loads the position, and a revocation clears the position and the nearby stores at once, cancels any reading in flight (its late answer is dropped) and Inicio asks for the followed-only feed again. A Mapa pass that overlaps the permission dialog joins it, so there is one prompt and one reading. An approximate grant is used as the OS returns it; precision is never requested. The position is a single reading (`getCurrentPositionAsync`, without the system settings dialog, so turned-off location services are an error state and not a second prompt). There is no watch, no `UserLocation`, no background location or foreground service, and the position is held in memory only: never stored, logged or sent anywhere but as the `lat`/`lng` query to the signed-in customer's API.

**Shared state.** Inicio and Mapa stay mounted once opened, so a `DiscoveryProvider` inside the protected tabs holds the position, the confirmed follow results and a revision that grows once per confirmed follow. The provider is unmounted whenever the profile gate closes (logout, a refused profile) and is keyed by customer, so a late position or answer is dropped and a new login never inherits the old position. Reads are tagged by the position and by order, so an older answer cannot overwrite a newer one.

**Mapbox token and native build.** The map needs the PUBLIC token (`pk.…`), never a secret one, and no Mapbox downloads token (the plugin states it is no longer required). Put `MAPBOX_ACCESS_TOKEN` in this package's own `.env` (Expo CLI loads it before reading `app.config.js`) or export it in the shell (the name is already allowed by `turbo.json`); the repository root `.env` is NOT read by the Expo apps. The two new native modules mean **Expo Go cannot run Savanhi Clientes and a new Android development-client build is required** (`expo-dev-client` is already installed). The Android permissions declared in `app.config.js` are the two foreground location ones; `expo-location` needs no config plugin.

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
| Root `.env` file (copy of `.env.example`) | Works as is for the backend, which reads `.env` files itself, after Turbo starts it. The Expo apps read their own package `.env`, not this file.                                                                                                                                                                                                     |
| Variables exported in the shell or CI     | Only names listed in `turbo.json` (`tasks.dev.env`) reach the tasks. That list holds `DATABASE_URL`, `AUTH_JWT_SECRET` and the five required `GARAGE_*` names. Optional backend variables (for example `GARAGE_PUBLIC_BASE_URL` or `RATE_LIMIT_*`) must go in the `.env` file. |

The backend refuses to boot without `DATABASE_URL`, `AUTH_JWT_SECRET` and the five `GARAGE_*` variables. This package reads only the public `EXPO_PUBLIC_CLIENTES_API_URL` (see above) and the public `MAPBOX_ACCESS_TOKEN`.

## Verified so far

| Check                            | Result                                                    |
| -------------------------------- | --------------------------------------------------------- |
| Jest (`jest-expo`)               | 305 tests (246 before the Mapa unit plus 59 for Mapa, location, the shared state, revocation ordering and the config); every call is mocked (fetch, the OS location module, the AppState adapter and the Mapbox components), no real server, tile or token |
| Android Hermes export, `expo config` | The JS bundle exports to Hermes bytecode (4.43 MB) and the public config lists Android only, the Mapbox plugin and the two foreground location permissions: JS and config only |
| Device or emulator, APK build    | **Not verified.** The map, tiles, the system prompt and the real permission transitions have never run on a device; the merged Android manifest is read from the library manifests, not from a Gradle build |

## Commands

| Command                                     | Purpose            |
| ------------------------------------------- | ------------------ |
| `pnpm --filter clientes-mobile test`        | Jest (`jest-expo`) |
| `pnpm --filter clientes-mobile check-types` | `tsc --noEmit`     |

## Next step

The wallet and claiming (T2e) come next. Login, session and profile code lives in `src/features/auth`; the feed, following, Mapa and location live in `src/features/discovery`.
