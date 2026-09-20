import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { CatalogObservedPrice } from "@repo/api-contracts/catalog";
import { StockBadge } from "./StockBadge";

export type Product = {
  id: string;
  name: string;
  category: string;
  brand: string;
  presentation: string;
  price: number | null;
  observedPrice: CatalogObservedPrice | null;
  stock: number;
  active: boolean;
};

type ProductCardProps = {
  product: Product;
  onUpdate: (changes: {
    price?: number | null;
    stock?: number;
    active?: boolean;
  }) => Promise<void>;
  onRemove: () => Promise<void>;
  updating: boolean;
};

export function ProductCard({
  product,
  onUpdate,
  onRemove,
  updating,
}: ProductCardProps) {
  const [stock, setStock] = useState(String(product.stock));
  const [price, setPrice] = useState(
    product.price === null ? "" : String(product.price),
  );

  const save = async () => {
    const nextStock = Number(stock);
    const nextPrice = price.trim() ? Number(price) : null;
    if (
      !Number.isInteger(nextStock) ||
      nextStock < 0 ||
      (nextPrice !== null && (!Number.isFinite(nextPrice) || nextPrice < 0))
    )
      return;
    await onUpdate({ stock: nextStock, price: nextPrice });
  };

  return (
    <View className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <View className="flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1">
          <Text
            numberOfLines={1}
            className="text-sm font-semibold text-slate-800"
          >
            {product.name}
          </Text>
          <Text className="mt-0.5 text-xs text-slate-500">
            {product.brand} · {product.category}
          </Text>
          {product.presentation ? (
            <Text className="mt-0.5 text-xs text-slate-500">
              {product.presentation}
            </Text>
          ) : null}
          {product.observedPrice && product.observedPrice.amount !== null ? (
            <Text className="mt-0.5 text-xs text-slate-500">
              Referencia de mercado (Supermaxi):{" "}
              {product.observedPrice.amount.toFixed(2)}{" "}
              {product.observedPrice.currency}
            </Text>
          ) : null}
        </View>
        <StockBadge stock={product.stock} />
      </View>
      <View className="mt-3 flex-row gap-2">
        <TextInput
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder="Precio"
          placeholderTextColor="#94a3b8"
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"
        />
        <TextInput
          value={stock}
          onChangeText={setStock}
          keyboardType="numeric"
          placeholder="Stock"
          placeholderTextColor="#94a3b8"
          className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"
        />
      </View>
      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-xs text-slate-600">
          Estado: {product.active ? "Activo" : "Inactivo"}
        </Text>
        <View className="flex-row gap-2">
          <Pressable
            disabled={updating}
            onPress={() => void onUpdate({ active: !product.active })}
            className="rounded-lg border border-slate-200 px-3 py-2"
          >
            <Text className="text-xs font-semibold text-slate-700">
              {product.active ? "Desactivar" : "Activar"}
            </Text>
          </Pressable>
          <Pressable
            disabled={updating}
            onPress={save}
            className="rounded-lg bg-emerald-600 px-3 py-2"
          >
            <Text className="text-xs font-semibold text-white">
              {updating ? "Guardando..." : "Guardar"}
            </Text>
          </Pressable>
          <Pressable
            disabled={updating}
            onPress={onRemove}
            className="rounded-lg border border-rose-200 px-3 py-2"
          >
            <Text className="text-xs font-semibold text-rose-700">Quitar</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
