import type {
  Coupon,
  CouponCreateRequest,
  CouponProductRef,
  CouponType,
  CouponUpdateRequest,
} from "@repo/api-contracts";

import { isDateOnly } from "@/src/lib/date-only";

/**
 * The coupon editor's state and its rules, with no React and no network in
 * sight, so S4, S5, S6 and S11 are decided in one place that can be asserted
 * directly.
 *
 * Everything is a string here because every field arrives from a `TextInput`.
 * The conversion to the typed payload happens once, in
 * `toCouponCreateRequest` / `toCouponUpdateRequest`, and only after the form
 * validates — a payload the form rejects is never built.
 *
 * `paused` is deliberately NOT a form field: pause and activate are their own
 * routes (T4), so editing a coupon can never take it out of circulation by
 * accident. Neither the coupon id nor the store id is a form field either, so
 * no draft can carry an identifier onto a screen (S11).
 */
export type CouponFormState = {
  type: CouponType;
  title: string;
  description: string;
  freeText: string;
  percentageValue: string;
  fixedAmountValue: string;
  validFrom: string;
  validTo: string;
  totalStock: string;
  products: CouponProductRef[];
  imageObjectKey: string | null;
};

export const EMPTY_COUPON_FORM: CouponFormState = {
  type: "free_text",
  title: "",
  description: "",
  freeText: "",
  percentageValue: "",
  fixedAmountValue: "",
  validFrom: "",
  validTo: "",
  totalStock: "",
  products: [],
  imageObjectKey: null,
};

export type CouponFormField =
  | "title"
  | "value"
  | "validity"
  | "totalStock"
  | "products";

export type CouponFormErrors = Partial<Record<CouponFormField, string>>;

/** S5 — only a `2x1 / combo` coupon links more than one product. */
export function allowsMultipleProducts(type: CouponType): boolean {
  return type === "combo";
}

/** The pair, not the id alone: the same id under the two sources is two products. */
const refKey = (ref: CouponProductRef) => `${ref.source}:${ref.productId}`;

/**
 * Tapping a product in the picker. A single-product type REPLACES its selection
 * instead of growing an invalid one the backend would reject, and tapping the
 * product already chosen deselects it.
 */
export function toggleProductSelection(
  products: CouponProductRef[],
  ref: CouponProductRef,
  type: CouponType,
): CouponProductRef[] {
  const key = refKey(ref);
  const already = products.some((product) => refKey(product) === key);
  if (already) {
    return products.filter((product) => refKey(product) !== key);
  }
  return allowsMultipleProducts(type) ? [...products, ref] : [ref];
}

const INTEGER_PATTERN = /^\d+$/;
const AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export function validateCouponForm(state: CouponFormState): CouponFormErrors {
  const errors: CouponFormErrors = {};

  const title = state.title.trim();
  if (!title) {
    errors.title = "Escribe un título para el cupón.";
  } else if (title.length > 120) {
    errors.title = "El título admite hasta 120 caracteres.";
  }

  // S4 — exactly the value field of the chosen type is required, and a
  // `2x1 / combo` carries none at all.
  if (state.type === "free_text") {
    const freeText = state.freeText.trim();
    if (!freeText) {
      errors.value = "Escribe el texto del cupón.";
    } else if (freeText.length > 280) {
      errors.value = "El texto admite hasta 280 caracteres.";
    }
  }
  if (state.type === "percentage") {
    const raw = state.percentageValue.trim();
    const value = Number(raw);
    if (
      !INTEGER_PATTERN.test(raw) ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 100
    ) {
      errors.value = "El descuento debe ser un número entero entre 1 y 100.";
    }
  }
  if (state.type === "fixed_amount") {
    const raw = state.fixedAmountValue.trim();
    if (!AMOUNT_PATTERN.test(raw) || Number(raw) <= 0) {
      errors.value = "El monto debe ser mayor que cero, con hasta 2 decimales.";
    }
  }

  // S6/S11 — a date-only window, in order. Both ends are checked as real
  // calendar dates, so the backend's `z.iso.date()` never sees a day the month
  // does not have.
  if (!isDateOnly(state.validFrom) || !isDateOnly(state.validTo)) {
    errors.validity = "Usa el formato AAAA-MM-DD en ambas fechas.";
  } else if (state.validFrom > state.validTo) {
    errors.validity =
      "La vigencia debe empezar antes o el mismo día en que termina.";
  }

  const stock = state.totalStock.trim();
  if (!INTEGER_PATTERN.test(stock)) {
    errors.totalStock = "El stock total debe ser un número entero de 0 o más.";
  }

  // S5 — never zero products; exactly one unless the type is `2x1 / combo`.
  const keys = new Set(state.products.map(refKey));
  if (state.products.length < 1) {
    errors.products = "Elige al menos 1 producto para el cupón.";
  } else if (keys.size !== state.products.length) {
    errors.products = "Un cupón no puede repetir el mismo producto.";
  } else if (!allowsMultipleProducts(state.type) && state.products.length > 1) {
    errors.products = "Este tipo de cupón admite 1 solo producto.";
  }

  return errors;
}

/** The fields every payload carries, whatever the type. */
function sharedFields(state: CouponFormState) {
  return {
    title: state.title.trim(),
    validFrom: state.validFrom,
    validTo: state.validTo,
    totalStock: Number(state.totalStock.trim()),
  };
}

/** Exactly the value field of the chosen type, and none of the others (S4). */
function typeFields(state: CouponFormState) {
  switch (state.type) {
    case "free_text":
      return { type: "free_text" as const, freeText: state.freeText.trim() };
    case "percentage":
      return {
        type: "percentage" as const,
        percentageValue: Number(state.percentageValue.trim()),
      };
    case "fixed_amount":
      return {
        type: "fixed_amount" as const,
        fixedAmountValue: Number(state.fixedAmountValue.trim()),
      };
    case "combo":
      return { type: "combo" as const };
  }
}

export function toCouponCreateRequest(
  state: CouponFormState,
): CouponCreateRequest | null {
  if (Object.keys(validateCouponForm(state)).length > 0) return null;

  const description = state.description.trim();
  return {
    ...sharedFields(state),
    ...typeFields(state),
    // A coupon is born active. `paused` is not a form field — pause and
    // activate are their own routes — so the value is a constant, not a choice.
    paused: false,
    ...(description ? { description } : {}),
    ...(state.imageObjectKey ? { imageObjectKey: state.imageObjectKey } : {}),
    products: state.products,
  };
}

/**
 * An update RESTATES the type, which the contract requires so it knows which
 * product cardinality applies; T4 answers 409 if it differs from the stored
 * one, which is why the editor never offers the type as a choice.
 *
 * An emptied description is sent as `null` — the tendero cleared it on purpose
 * — rather than being dropped from the payload, which would leave the old text
 * in place. `paused` is never sent at all, so an edit cannot take a coupon out
 * of circulation.
 */
export function toCouponUpdateRequest(
  state: CouponFormState,
): CouponUpdateRequest | null {
  if (Object.keys(validateCouponForm(state)).length > 0) return null;

  const description = state.description.trim();
  return {
    ...sharedFields(state),
    ...typeFields(state),
    description: description || null,
    ...(state.imageObjectKey ? { imageObjectKey: state.imageObjectKey } : {}),
    products: state.products,
  };
}

/**
 * A stored coupon as an editable form. `imageObjectKey` starts null because the
 * response carries a read URL and never the object key: the key only exists
 * when the tendero uploads a NEW photo in this session, and leaving it null is
 * what keeps the existing photo untouched by an edit.
 */
export function couponToFormState(coupon: Coupon): CouponFormState {
  return {
    type: coupon.type,
    title: coupon.title,
    description: coupon.description ?? "",
    freeText: coupon.freeText ?? "",
    percentageValue:
      coupon.percentageValue === null ? "" : String(coupon.percentageValue),
    fixedAmountValue:
      coupon.fixedAmountValue === null ? "" : String(coupon.fixedAmountValue),
    validFrom: coupon.validFrom,
    validTo: coupon.validTo,
    totalStock: String(coupon.totalStock),
    products: coupon.products.map((product) => ({
      source: product.source,
      productId: product.productId,
    })),
    imageObjectKey: null,
  };
}
