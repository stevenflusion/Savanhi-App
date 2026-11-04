import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import {
  productPriceLabel,
  productSourceLabel,
  productStockLabel,
  type Product,
} from "@/src/features/products/domain/product";
import {
  productCategoryColor,
  productCategoryIcon,
} from "@/src/features/products/domain/product-category";

/**
 * `Product` moved to the products feature when the detail screen started
 * reading the same shape. It is re-exported here because the workspace and
 * its tests have always imported it from this module.
 */
export type { Product };

type ProductCardProps = {
  product: Product;
  onUpdate: (changes: {
    price?: number | null;
    stock?: number;
    active?: boolean;
    saleUnit?: Product["saleUnit"];
    integerOnly?: boolean;
  }) => Promise<void>;
  onRemove: () => Promise<void>;
  /** Tapping the card body opens the product's own detail screen (S14). */
  onOpen: () => void;
  /** The editor is collapsed until the tendero asks for it. */
  expanded: boolean;
  onToggleEdit: () => void;
  updating: boolean;
};

/**
 * One product as the tendero's catalog shows it (S14).
 *
 * The card language is the coupons': a soft pastel tile with the CATEGORY
 * icon — a product has no photo anywhere in this MVP (S10, L9) — a bold name,
 * muted chips and the price as the one big number.
 *
 * The editor is COLLAPSED by default and is the same set of inputs the card
 * has always carried, not a new flow: the product detail's "Editar producto"
 * button lands here with this card already expanded, exactly as the coupon
 * detail lands on the coupon editor.
 *
 * S11: nothing rendered comes from an id, and the market reference shows the
 * amount and the currency and never the `observedAt` it was sorted by.
 */
export function ProductCard({
  product,
  onUpdate,
  onRemove,
  onOpen,
  expanded,
  onToggleEdit,
  updating,
}: ProductCardProps) {
  const [stock, setStock] = useState(String(product.stock));
  const [price, setPrice] = useState(
    product.price === null ? "" : String(product.price),
  );
  const colour = productCategoryColor(product.categoryKey);

  const save = async () => {
    const nextStock = Number(stock);
    const nextPrice = price.trim() ? Number(price) : null;
    if (
      !Number.isFinite(nextStock) ||
      nextStock < 0 ||
      (product.saleUnit === "unidad" || product.integerOnly
        ? !Number.isInteger(nextStock)
        : !/^\d+(?:\.\d{1,3})?$/.test(stock)) ||
      nextPrice === null ||
      !Number.isFinite(nextPrice) ||
      nextPrice <= 0 ||
      !/^\d+(?:\.\d{1,2})?$/.test(price.trim())
    )
      return;
    await onUpdate({ stock: nextStock, price: nextPrice });
  };

  return (
    <View className="w-full rounded-3xl bg-white p-4 shadow-sm">
      {/*
        The card BODY opens the detail; the actions below keep their own press
        targets, so editing a product can never navigate by accident.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ver ${product.name}`}
        onPress={onOpen}
      >
        <View className="flex-row items-center gap-3">
          <View
            testID={`product-category-tile-${product.id}`}
            style={{ backgroundColor: colour.surface }}
            className="h-20 w-20 items-center justify-center rounded-2xl"
          >
            <MaterialCommunityIcons
              name={productCategoryIcon(product.categoryKey)}
              size={34}
              color={colour.ink}
            />
          </View>

          <View className="min-w-0 flex-1">
            <Text
              numberOfLines={1}
              className="text-base font-semibold text-slate-900"
            >
              {product.name}
            </Text>
            <Text
              numberOfLines={1}
              className="mt-0.5 text-xl font-semibold text-slate-900"
            >
              {productPriceLabel(product.price)}
            </Text>
            <Text numberOfLines={1} className="mt-0.5 text-sm text-slate-500">
              {productStockLabel(product.stock)}
            </Text>
          </View>
        </View>
      </Pressable>

      <View className="mt-3 flex-row flex-wrap items-center gap-2">
        <Chip label={product.category} />
        <Chip label={productSourceLabel(product.source)} />
        {product.active ? null : <Chip label="Inactivo" tone="warning" />}
      </View>

      {product.presentation || product.brand ? (
        <Text numberOfLines={1} className="mt-2 text-sm text-slate-500">
          {[product.brand, product.presentation].filter(Boolean).join(" · ")}
        </Text>
      ) : null}

      {product.observedPrice && product.observedPrice.amount !== null ? (
        <Text className="mt-1 text-sm text-slate-500">
          Referencia de mercado (Supermaxi): $
          {product.observedPrice.amount.toFixed(2)}{" "}
          {product.observedPrice.currency}
        </Text>
      ) : null}

      {expanded ? (
        <View className="mt-4 border-t border-slate-100 pt-4">
          <View className="flex-row gap-2">
            <TextInput
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="Precio"
              placeholderTextColor="#94a3b8"
              className="flex-1 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-900"
            />
            <TextInput
              value={stock}
              onChangeText={setStock}
              keyboardType="decimal-pad"
              placeholder="Stock"
              placeholderTextColor="#94a3b8"
              className="w-24 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-900"
            />
          </View>

          <View className="mt-3 flex-row flex-wrap gap-2">
            {(["unidad", "kg", "g", "L", "ml"] as const).map((unit) => (
              <Pressable
                key={unit}
                accessibilityRole="button"
                onPress={() => void onUpdate({ saleUnit: unit })}
                className={`rounded-full px-3 py-2 ${
                  product.saleUnit === unit ? "bg-black" : "bg-slate-100"
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    product.saleUnit === unit ? "text-white" : "text-slate-700"
                  }`}
                >
                  {unit}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void onUpdate({ integerOnly: !product.integerOnly })
              }
              className="rounded-full bg-slate-100 px-3 py-2"
            >
              <Text className="text-xs font-semibold text-slate-700">
                {product.integerOnly
                  ? "Cantidades enteras"
                  : "Cantidades fraccionadas"}
              </Text>
            </Pressable>
          </View>

          <View className="mt-4 flex-row gap-2">
            {product.active ? (
              <Pressable
                accessibilityRole="button"
                disabled={updating}
                onPress={() => void onRemove()}
                className="min-h-[44px] flex-1 items-center justify-center rounded-full border border-slate-200 bg-white px-4"
              >
                <Text className="text-sm font-semibold text-slate-900">
                  Quitar
                </Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={
                  updating || product.price === null || product.price <= 0
                }
                onPress={() => void onUpdate({ active: true })}
                className="min-h-[44px] flex-1 items-center justify-center rounded-full border border-slate-200 bg-white px-4"
              >
                <Text className="text-sm font-semibold text-slate-900">
                  Activar
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={updating}
              onPress={save}
              className="min-h-[44px] flex-1 items-center justify-center rounded-full bg-black px-4"
            >
              <Text className="text-sm font-semibold text-white">
                {updating ? "Guardando..." : "Guardar"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Editar ${product.name}`}
        accessibilityState={{ expanded }}
        onPress={onToggleEdit}
        className="mt-3 min-h-[44px] items-center justify-center rounded-full border border-slate-200 bg-white px-4"
      >
        <Text className="text-sm font-semibold text-slate-900">
          {expanded ? "Cerrar" : "Editar"}
        </Text>
      </Pressable>
    </View>
  );
}

function Chip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <View
      className={`rounded-full px-3 py-1 ${
        tone === "warning" ? "bg-amber-100" : "bg-slate-100"
      }`}
    >
      <Text
        className={`text-xs font-semibold ${
          tone === "warning" ? "text-amber-800" : "text-slate-700"
        }`}
      >
        {label}
      </Text>
    </View>
  );
}
