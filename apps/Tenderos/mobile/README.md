# Tenderos Mobile

Aplicación Android de Expo + Expo Router + NativeWind para el monorepo. No se
mantienen destinos web ni iOS.

## Comandos

- `pnpm --filter tenderos-mobile dev`
- `pnpm --filter tenderos-mobile android`

## Backend local desde un teléfono

El teléfono Android y la computadora deben estar conectados a la misma red
Wi-Fi. Al iniciar Expo en modo LAN, la aplicación toma únicamente el hostname de
`Constants.expoConfig.hostUri` y usa `http://<host>:4300` como URL base del
backend. Los comandos `dev` y `android` publican el enlace LAN para abrirlo desde
el dispositivo. En desarrollo, este host de Expo tiene prioridad aunque exista
un valor histórico de `EXPO_PUBLIC_TENDEROS_API_URL`; no hace falta editar la IP
local en `.env` ni usar ADB.

Cuando Expo no informa un host durante desarrollo,
`EXPO_PUBLIC_TENDEROS_API_URL` queda disponible como escape hatch. Un valor vacío
se ignora y, si tampoco existe un override, se usa localhost únicamente para
desarrollo y herramientas locales.

Los builds de producción o release exigen un
`EXPO_PUBLIC_TENDEROS_API_URL` explícito con HTTPS. La aplicación falla al iniciar
si falta o usa HTTP; nunca cae a localhost en release.

## Tailwind global

La app usa `@repo/tailwind-config/native` como preset compartido.

## Rutas

- `app/_layout.tsx`: layout raiz del router.
- `app/index.tsx`: pantalla inicial.
