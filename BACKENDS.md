# Backend Architecture

The Tenderos backend uses `@repo/backend-core`. HTTP routers depend on application-facing repository methods; database rows and driver errors never cross the HTTP boundary.

## Local PostgreSQL

```bash
cp .env.example .env
docker compose up -d postgres
pnpm --filter @repo/backend-core db:migrate
pnpm --filter @repo/backend-core db:seed
pnpm --filter tenderos-backend dev
```

The database is PostgreSQL 16 with a persistent Compose volume and a healthcheck. `DATABASE_URL` points to it, while `AUTH_JWT_SECRET` signs access tokens. Use `pnpm --filter @repo/backend-core bootstrap:dev-admin` to create a local administrator.

## OTP email provider

Development uses `OTP_PROVIDER=development` and never logs the generated OTP. `OTP_DEV_CODE` may be set only outside production for deterministic local testing. Production must use `OTP_PROVIDER=resend`; startup validation then requires:

- `RESEND_API_KEY`: API key de Resend, enviada como credencial Bearer.
- `RESEND_FROM`: remitente verificado en Resend, por ejemplo `Savanhi <no-reply@tudominio.com>`.
- `RESEND_TIMEOUT_MS`: timeout positivo en milisegundos; por defecto `5000`.

El adaptador usa `fetch` nativo contra `https://api.resend.com/emails`, cancela solicitudes vencidas y traduce fallos de red, timeout, proveedor y configuración a errores tipados. Nunca expone la API key ni registra códigos OTP.

## Rate limiting

`RateLimiter` is the application boundary used by the HTTP middleware. The default implementation is process-local in-memory state and is intentionally suitable only for local development or a single backend instance. It is not shared across replicas and resets on restart. A Redis adapter can implement the same `check` contract later without changing routes or use cases; Redis is not mandatory for local development and is not added here.

## Shared flow

Each backend creates a context, which wires Drizzle PostgreSQL repositories and the JWT auth service. Controllers/routes validate input with Zod, call repository/use-case boundaries, and return the existing `{ data }`, `{ user }`, and `{ session }` response shapes.

## Production

The Tenderos backend has a non-root multi-stage Dockerfile at `apps/Tenderos/backend/Dockerfile`. Build it from the repository root with `docker build -f apps/Tenderos/backend/Dockerfile -t tenderos-backend .`.
