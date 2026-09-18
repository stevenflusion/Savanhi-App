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
