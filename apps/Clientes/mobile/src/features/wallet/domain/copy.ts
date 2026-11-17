/**
 * Customer-facing Spanish for Billetera and the QR (T2e.A, approved verbatim in
 * L19, L20 and L22): neutral/Ecuadorian, no voseo, written accents kept.
 * «Reintentar» and «Cerrar» are the shared action words of the app.
 */
export const WALLET_COPY = {
  title: "Billetera",
  loading: "Cargando billetera…",
  empty: "Aún no tienes cupones. Reclama uno desde Inicio",
  loadError: "No pudimos cargar tu billetera. Intenta de nuevo",
  claim: "Reclamar",
  claimed: "Cupón reclamado",
  viewWallet: "Ver Billetera",
  claimError: "No pudimos reclamar el cupón. Intenta de nuevo",
  viewQr: "Ver QR",
  qrLoading: "Preparando tu código…",
  qrInstruction: "Muestra este código en la tienda",
  qrError: "No pudimos mostrar tu código QR. Intenta de nuevo",
  /** The only label of the code image; it never carries the code itself. */
  qrAccessibility: "Código QR del cupón",
  unavailable: "Este cupón ya no está disponible",
  // «Devolver» (T2e.B): the confirmation is approved verbatim in L21, the
  // outcomes and the error in L22.
  release: "Devolver",
  cancel: "Cancelar",
  releaseConfirm: "¿Devolver este cupón? No podrás volver a reclamarlo",
  released: "Cupón devuelto",
  releaseCancelled: "Devolución cancelada",
  releaseError: "No pudimos devolver el cupón. Intenta de nuevo",
  retry: "Reintentar",
  close: "Cerrar",
} as const;

/** The four wallet statuses exactly as the server derives them (L20). */
export const STATUS_LABEL = {
  claimed: "Disponible",
  redeemed: "Canjeado",
  expired: "Vencido",
  released: "Devuelto",
} as const;
