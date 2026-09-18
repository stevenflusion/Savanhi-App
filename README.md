# Savanhi Tenderos

Savanhi SA Tenderos — Marketplace digital que revitaliza las tiendas de barrio de Quito conectando al consumidor con su tienda más cercana y ofertas reales de marcas en el canal tradicional.

## Monorepo

El monorepo contiene únicamente la aplicación móvil para tenderos y su backend.

## Desarrollo

```bash
cp .env.example .env
docker compose up -d postgres
pnpm --filter @repo/backend-core db:migrate
pnpm --filter @repo/backend-core db:seed
pnpm dev
```

`pnpm dev` inicia:

- `tenderos-mobile` con Expo en el puerto `8082`.
- `tenderos-backend` con Express en el puerto `4300`.
