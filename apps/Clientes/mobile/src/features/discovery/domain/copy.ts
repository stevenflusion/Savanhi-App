/**
 * Customer-facing Spanish for Inicio (T2d, approved verbatim on 2026-11-08):
 * neutral/Ecuadorian, no voseo, written accents kept. «Reintentar» is the same
 * word the profile gate already uses.
 */
export const DISCOVERY_COPY = {
  title: "Inicio",
  loadingCoupons: "Cargando cupones…",
  noCoupons: "No hay cupones disponibles por ahora",
  noFollowedStores:
    "Aún no sigues ninguna tienda. Abre el Mapa para encontrar tiendas cercanas",
  couponsError: "No pudimos cargar los cupones. Intenta de nuevo",
  storesError: "No pudimos cargar las tiendas. Intenta de nuevo",
  follow: "Seguir",
  following: "Siguiendo",
  unfollow: "Dejar de seguir",
  followError: "No pudimos actualizar el seguimiento. Intenta de nuevo",
  noDistance: "Sin distancia",
  // Mapa (T2d.B). The location sentence is the orchestrator's formulation of
  // the user's confirmed meaning (L15) and was retained in the copy approval.
  mapTitle: "Mapa",
  locationRequired:
    "La ubicación es necesaria para mostrarte tiendas cercanas. Puedes activarla más adelante desde los ajustes de Savanhi en tu teléfono",
  searchingStores: "Buscando tiendas cercanas…",
  noNearbyStores: "No hay tiendas cercanas",
  retry: "Reintentar",
} as const;
