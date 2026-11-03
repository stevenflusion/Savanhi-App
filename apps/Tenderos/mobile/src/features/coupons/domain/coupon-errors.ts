/**
 * The backend answers `{ error: "<English sentence>" }` for every rejection it
 * can describe (`createErrorHandler`), and the product's UI copy is Spanish.
 * This is the one place that bridges the two.
 *
 * A message this table does not know is NOT shown raw: an English sentence from
 * a constraint the app has never seen is worse for the tendero than the
 * action's own Spanish wording, so the caller's fallback wins. Adding a
 * backend message therefore means adding it here, which is what the repository
 * suite pins.
 */
const SPANISH_BY_API_MESSAGE: Record<string, string> = {
  // Owner scoping (T4 routes).
  "Store does not belong to this tendero.":
    "Esta tienda no pertenece a tu cuenta.",
  "Coupon does not belong to this tendero.":
    "Este cupón no pertenece a tu tienda.",
  "Coupon not found.": "Este cupón ya no existe.",
  "This image reference does not belong to this store.":
    "Esa imagen no pertenece a esta tienda.",

  // S5 — the product link.
  "Every coupon product must belong to this store.":
    "Cada producto del cupón debe ser de esta tienda.",
  "A coupon cannot reference the same product twice.":
    "Un cupón no puede repetir el mismo producto.",
  "A coupon product names exactly one product source.":
    "Cada producto del cupón debe venir de una sola fuente.",

  // S4 — the single type and its own value.
  "The coupon type cannot be changed.": "El tipo de cupón no se puede cambiar.",
  "Unknown coupon type.": "Ese tipo de cupón no existe.",
  "This coupon type does not carry that value.":
    "Ese valor no corresponde al tipo de cupón elegido.",
  "A percentage discount must be between 1 and 100.":
    "El descuento debe estar entre 1 y 100.",
  "A fixed amount must be greater than zero.":
    "El monto fijo debe ser mayor que cero.",

  // S6 — validity, stock and the claims already made.
  "The validity must start on or before it ends.":
    "La vigencia debe empezar antes o el mismo día en que termina.",
  "The total stock cannot be negative.": "El stock total no puede ser negativo.",
  "The total stock cannot be lower than the number of claims already made.":
    "El stock total no puede ser menor que la cantidad de cupones ya reclamados.",

  // S10 — the coupon photo.
  "This image is already used by another coupon.":
    "Esa imagen ya está usada por otro cupón.",

  // The shared handlers.
  "Invalid request payload.": "Revisa los datos del cupón e inténtalo de nuevo.",
  "No se pudo conectar con el servidor.": "No se pudo conectar con el servidor.",
  "Sesión no encontrada.": "Tu sesión expiró. Vuelve a entrar.",
};

export function toSpanishCouponError(
  apiError: string | undefined,
  fallback: string,
): string {
  if (!apiError) return fallback;
  return SPANISH_BY_API_MESSAGE[apiError.trim()] ?? fallback;
}
