import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { CouponType } from "@repo/api-contracts";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { categoryIconFor } from "../../domain/category-icons";
import {
  allowsMultipleProducts,
  toggleProductSelection,
  validateCouponForm,
  type CouponFormErrors,
  type CouponFormState,
} from "../../domain/coupon-form";
import {
  COUPON_TYPE_ORDER,
  comboShapeLabel,
  couponTypeLabel,
  productCardinalityHint,
} from "../../domain/coupon-labels";
import type { CouponProductOption } from "../../application/ports/coupons-repository";

/**
 * Create and edit are the SAME editor, with one difference the product rules
 * make unavoidable: the type can be chosen while creating and is fixed while
 * editing, because T4 answers 409 to an update whose type differs from the
 * stored one (S4 — the type is not mutable in the MVP).
 *
 * Validation runs here on every save and the payload is only built when it
 * passes, so the backend never sees a cardinality the form could have caught
 * (S5).
 */
export function CouponEditor({
  state,
  onChange,
  products,
  editing,
  saving,
  uploading,
  photoReady,
  error,
  onPickPhoto,
  onSave,
  onCancel,
}: {
  state: CouponFormState;
  onChange: (next: CouponFormState) => void;
  products: CouponProductOption[];
  editing: boolean;
  saving: boolean;
  uploading: boolean;
  photoReady: boolean;
  error: string;
  onPickPhoto: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [errors, setErrors] = useState<CouponFormErrors>({});
  const set = <K extends keyof CouponFormState>(
    field: K,
    value: CouponFormState[K],
  ) => onChange({ ...state, [field]: value });

  const chooseType = (type: CouponType) =>
    onChange({
      ...state,
      type,
      // A type that links one product cannot keep a multi-product selection.
      products: allowsMultipleProducts(type)
        ? state.products
        : state.products.slice(0, 1),
    });

  const save = () => {
    const found = validateCouponForm(state);
    setErrors(found);
    if (Object.keys(found).length === 0) onSave();
  };

  const comboShape =
    state.type === "combo" ? comboShapeLabel(state.products.length) : null;

  return (
    <View className="w-full max-w-xl self-center gap-3">
      <View className="rounded-3xl bg-white p-4 shadow-sm">
        <Text className="text-base font-semibold text-slate-900">
          {editing ? "Editar cupón" : "Nuevo cupón"}
        </Text>

        {editing ? (
          <Text className="mt-1 text-sm text-slate-500">
            {`Tipo: ${couponTypeLabel(state.type)}`}
          </Text>
        ) : (
          <View className="mt-3 flex-row flex-wrap gap-2">
            {COUPON_TYPE_ORDER.map((type) => (
              <Pressable
                key={type}
                accessibilityRole="button"
                onPress={() => chooseType(type)}
                className={`min-h-[44px] items-center justify-center rounded-full border px-4 ${
                  state.type === type
                    ? "border-black bg-black"
                    : "border-slate-200 bg-white"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    state.type === type ? "text-white" : "text-slate-700"
                  }`}
                >
                  {couponTypeLabel(type)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <TextInput
          value={state.title}
          onChangeText={(value) => set("title", value)}
          placeholder="Título del cupón"
          placeholderTextColor="#94a3b8"
          className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900"
        />
        <FieldError message={errors.title} />

        <TextInput
          value={state.description}
          onChangeText={(value) => set("description", value)}
          placeholder="Descripción (opcional)"
          placeholderTextColor="#94a3b8"
          multiline
          className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900"
        />

        {state.type === "free_text" ? (
          <TextInput
            value={state.freeText}
            onChangeText={(value) => set("freeText", value)}
            placeholder="Texto del cupón"
            placeholderTextColor="#94a3b8"
            multiline
            className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900"
          />
        ) : null}
        {state.type === "percentage" ? (
          <TextInput
            value={state.percentageValue}
            onChangeText={(value) => set("percentageValue", value)}
            placeholder="Descuento (1 a 100)"
            placeholderTextColor="#94a3b8"
            keyboardType="number-pad"
            className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900"
          />
        ) : null}
        {state.type === "fixed_amount" ? (
          <TextInput
            value={state.fixedAmountValue}
            onChangeText={(value) => set("fixedAmountValue", value)}
            placeholder="Monto fijo (USD)"
            placeholderTextColor="#94a3b8"
            keyboardType="decimal-pad"
            className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900"
          />
        ) : null}
        <FieldError message={errors.value} />

        <View className="mt-2 flex-row gap-2">
          <TextInput
            value={state.validFrom}
            onChangeText={(value) => set("validFrom", value)}
            placeholder="Desde (AAAA-MM-DD)"
            placeholderTextColor="#94a3b8"
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900"
          />
          <TextInput
            value={state.validTo}
            onChangeText={(value) => set("validTo", value)}
            placeholder="Hasta (AAAA-MM-DD)"
            placeholderTextColor="#94a3b8"
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900"
          />
        </View>
        <FieldError message={errors.validity} />

        <TextInput
          value={state.totalStock}
          onChangeText={(value) => set("totalStock", value)}
          placeholder="Stock total"
          placeholderTextColor="#94a3b8"
          keyboardType="number-pad"
          className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900"
        />
        <FieldError message={errors.totalStock} />

        <Pressable
          accessibilityRole="button"
          disabled={uploading}
          onPress={onPickPhoto}
          className="mt-3 min-h-[44px] flex-row items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4"
        >
          <MaterialCommunityIcons
            name={photoReady ? "image-outline" : "camera-outline"}
            size={18}
            color="#1f2937"
          />
          <Text className="text-sm font-semibold text-slate-900">
            {uploading ? "Subiendo foto..." : photoReady ? "Foto lista" : "Agregar foto"}
          </Text>
        </Pressable>
      </View>

      <View className="rounded-3xl bg-white p-4 shadow-sm">
        <Text className="text-base font-semibold text-slate-900">Productos</Text>
        <Text className="mt-1 text-sm text-slate-500">
          {productCardinalityHint(state.type)}
        </Text>
        {comboShape ? (
          <Text className="mt-1 text-sm font-semibold text-slate-900">
            {`Este cupón es un ${comboShape}.`}
          </Text>
        ) : null}

        <View className="mt-3 gap-2">
          {products.map((option) => {
            const selected = state.products.some(
              (product) =>
                product.source === option.source &&
                product.productId === option.productId,
            );
            return (
              <Pressable
                key={`${option.source}:${option.productId}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() =>
                  set(
                    "products",
                    toggleProductSelection(
                      state.products,
                      { source: option.source, productId: option.productId },
                      state.type,
                    ),
                  )
                }
                className={`flex-row items-center gap-3 rounded-2xl border px-3 py-3 ${
                  selected ? "border-black bg-slate-50" : "border-slate-200 bg-white"
                }`}
              >
                <MaterialCommunityIcons
                  name={categoryIconFor(option.category)}
                  size={20}
                  color="#1f2937"
                />
                <View className="min-w-0 flex-1">
                  <Text
                    numberOfLines={1}
                    className="text-sm font-semibold text-slate-900"
                  >
                    {option.name}
                  </Text>
                  <Text className="text-xs text-slate-500">
                    {option.category?.name ?? "Sin categoría"}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name={selected ? "check-circle" : "circle-outline"}
                  size={20}
                  color={selected ? "#111827" : "#cbd5e1"}
                />
              </Pressable>
            );
          })}
          {!products.length ? (
            <Text className="text-sm text-slate-500">
              Agrega productos a tu tienda para poder crear cupones.
            </Text>
          ) : null}
        </View>
        <FieldError message={errors.products} />
      </View>

      {error ? (
        <View className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <Text className="text-sm text-rose-700">{error}</Text>
        </View>
      ) : null}

      <View className="flex-row gap-2 pb-2">
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={onCancel}
          className="min-h-[52px] flex-1 items-center justify-center rounded-full border border-slate-200 bg-white"
        >
          <Text className="text-base font-semibold text-slate-900">Cancelar</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={save}
          className="min-h-[52px] flex-[2] flex-row items-center justify-center gap-2 rounded-full bg-black"
        >
          {saving ? <ActivityIndicator size="small" color="#ffffff" /> : null}
          <Text className="text-base font-semibold text-white">Guardar cupón</Text>
        </Pressable>
      </View>
    </View>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <Text className="mt-1 text-sm text-rose-700">{message}</Text>;
}
