# Tenderos Backend

Backend dedicado para la seccion de tenderos.

El servidor local escucha en las interfaces de red disponibles. Con el teléfono
y la computadora en la misma red Wi-Fi, se puede validar desde Android con
`GET http://<host-de-la-computadora>:4300/health`.

## Endpoints para Postman

- `GET http://localhost:4300/health`
- `GET http://localhost:4300/api/v1/ping`
- `GET http://localhost:4300/api/v1/tenderos/status`
- `POST http://localhost:4300/auth/otp/request`
- `POST http://localhost:4300/auth/otp/verify`
- `POST http://localhost:4300/auth/refresh`
- `GET http://localhost:4300/auth/me`
- `POST http://localhost:4300/auth/logout`

## Recordatorio de vencimiento de cupones (job de una sola pasada)

Un planificador externo ejecuta el job; el servidor Express no lo ejecuta ni tiene temporizadores.
Aplica antes la migración `0012_coupon_expiry_reminders` (y `0011` antes de desplegar el cierre de sesión que borra dispositivos).

| Comando | Qué hace |
|---------|----------|
| `node packages/backend-core/dist/scripts/coupon-expiry-reminders.js report` | Solo lectura: conteos del piloto por grupo. Nunca envía. |
| `node packages/backend-core/dist/scripts/coupon-expiry-reminders.js run` | Asigna y envía. No envía nada salvo que `COUPON_EXPIRY_REMINDERS_SEND=true`. |

La sintaxis es estricta: exactamente un comando y ningún argumento más. No existe `--dry-run` ni ninguna otra opción; cualquier argumento extra termina con el uso en stderr y código 2, antes de conectar a la base de datos.
Ambos leen solo `DATABASE_URL` del entorno (no cargan archivos `.env`) y ejecutan desde `/app` en la imagen Docker.
En desarrollo: `pnpm --filter @repo/backend-core coupon-expiry-reminders run`.

- **Quién recibe:** cupones reservados que vencen mañana (calendario `America/Bogota`), sin liberar ni canjear, de un cliente activo, verificado y mayor de edad con un dispositivo registrado en una familia de sesión vigente. Un cupón pausado sigue siendo canjeable, así que sí se avisa.
- **Una vez por reserva:** la tabla `coupon_expiry_reminders` tiene una fila por reserva (llave primaria) y se adquiere con una sola sentencia atómica. El grupo `holdout` se registra igual pero nunca se envía.
- **Un solo intento:** ante un resultado desconocido (timeout, 5xx) no se reintenta. Preferimos perder un aviso a enviarlo dos veces. La adquisición nunca se revierte tras una llamada al proveedor.
- **Carrera residual:** no se mantienen bloqueos durante la llamada a Expo, por lo que un canje o cierre de sesión posterior a la última verificación puede ocurrir igualmente. El mensaje es genérico y la app consulta el estado real al abrirse.
- **Estados:** `accepted` significa solo que Expo devolvió un ticket, no que el aviso llegó. `unknown` incluye intentos que quedaron en `sending` más de 15 minutos (job caído).
- **`DeviceNotRegistered`:** se borra el dispositivo solo si la fila sigue siendo idéntica a la usada (id, usuario, familia y token). El resto se conserva.
- **Reporte:** cuenta reservas maduras (vencidas) desde la asignación guardada, con denominador por grupo, canjeadas dentro de su ventana (desde el día de asignación hasta el vencimiento) y canjeadas antes de ella.
- **Sin QR ni datos personales:** el push lleva `data.type=coupon-expiry-reminder` y `data.claimId`.
