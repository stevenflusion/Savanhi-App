/**
 * Customer-facing Spanish for the profile gate (C8, C9). Neutral/Ecuadorian
 * Spanish: no voseo or regionalisms, written accents kept. Approved verbatim.
 */
export const GATE_COPY = {
  titleNewProfile: "Completa tu perfil",
  titleBirthDateOnly: "Completa tu fecha de nacimiento",
  nameLabel: "Nombre",
  surnameLabel: "Apellido (opcional)",
  birthDateLabel: "Fecha de nacimiento",
  birthDateHint: "Día / Mes / Año",
  dayLabel: "Día",
  monthLabel: "Mes",
  yearLabel: "Año",
  nameRequired: "Ingresa tu nombre",
  birthDateIncomplete: "Completa tu fecha de nacimiento",
  birthDateInvalid: "Ingresa una fecha válida",
  loadError: "No pudimos cargar tu perfil. Intenta de nuevo",
  saveError: "No pudimos guardar tu perfil. Intenta de nuevo",
  wrongRole: "Esta cuenta no es de cliente",
  underage: "Debes tener al menos 18 años para usar Savanhi",
  continue: "Continuar",
  retry: "Reintentar",
  signOut: "Cerrar sesión",
} as const;

/** Example destination for both legal labels; NOT final legal documents. */
export const EXAMPLE_LEGAL_URL = "https://savanhi.com";
