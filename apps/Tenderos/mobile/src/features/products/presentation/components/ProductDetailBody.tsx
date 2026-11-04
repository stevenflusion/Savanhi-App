import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Text, View } from "react-native";

import {
  productPriceLabel,
  productSourceLabel,
  productStockLabel,
  type Product,
} from "../../domain/product";
import {
  productCategoryColor,
  productCategoryIcon,
} from "../../domain/product-category";

/**
 * One page of the product detail carousel (S14).
 *
 * It is a pastel CATEGORY TILE with the category's icon drawn large, and
 * never a photo: the MVP has no product images at all (S10, L9), so there is
 * nothing to fall back from. It is the same two mappings `CouponDetailPage`
 * uses, so a product cannot look like one thing under a coupon and another
 * here.
 */
export function ProductDetailPage({ product }: { product: Product }) {
  const colour = productCategoryColor(product.categoryKey);

  return (
    <View
      testID={`product-detail-page-${product.id}`}
      style={{ backgroundColor: colour.surface }}
      className="h-64 items-center justify-center overflow-hidden rounded-3xl"
    >
      <MaterialCommunityIcons
        name={productCategoryIcon(product.categoryKey)}
        size={128}
        color={colour.ink}
      />
    </View>
  );
}

/**
 * Everything under the carousel, for the product currently centred.
 *
 * Every value is a field of the catalog routes the tendero app already reads.
 * There is NO expiration line: no product route, column or contract carries an
 * expiration date anywhere in this codebase, and inventing one would be a
 * number nobody entered.
 *
 * S11: no id and no clock time. The market reference renders the amount and
 * the currency and never the `observedAt` timestamp it was sorted by.
 */
export function ProductDetailBody({ product }: { product: Product }) {
  return (
    <View testID="product-detail-body" className="w-full max-w-xl self-center">
      <Text className="text-3xl font-semibold tracking-tight text-slate-900">
        {product.name}
      </Text>

      <View className="mt-3 flex-row flex-wrap items-center gap-2">
        <Chip label={product.category} />
        <Chip label={productSourceLabel(product.source)} />
        {product.active ? null : <Chip label="Inactivo" tone="warning" />}
      </View>

      {product.brand || product.presentation ? (
        <Text className="mt-3 text-base text-slate-500">
          {[product.brand, product.presentation].filter(Boolean).join(" · ")}
        </Text>
      ) : null}

      <View className="mt-5 flex-row items-end justify-between gap-3">
        <Text className="text-4xl font-semibold tracking-tight text-slate-900">
          {productPriceLabel(product.price)}
        </Text>
        <Text className="pb-1 text-base font-semibold text-slate-500">
          {productStockLabel(product.stock)}
        </Text>
      </View>

      <View className="mt-5 flex-row rounded-2xl bg-white py-4 shadow-sm">
        <Fact
          icon="scale-balance"
          label="Se vende por"
          value={product.saleUnit}
        />
        <Fact
          icon="numeric"
          label="Cantidades"
          value={
            product.saleUnit === "unidad" || product.integerOnly
              ? "Enteras"
              : "Fraccionadas"
          }
          last
        />
      </View>

      {product.observedPrice && product.observedPrice.amount !== null ? (
        <View className="mt-3 flex-row items-center gap-2">
          <MaterialCommunityIcons
            name="tag-outline"
            size={16}
            color="#64748b"
          />
          <Text className="flex-1 text-sm text-slate-500">
            Referencia de mercado (Supermaxi): $
            {product.observedPrice.amount.toFixed(2)}{" "}
            {product.observedPrice.currency}
          </Text>
        </View>
      ) : null}
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
      className={`rounded-full px-3 py-1.5 ${
        tone === "warning" ? "bg-amber-100" : "bg-slate-100"
      }`}
    >
      <Text
        className={`text-sm font-semibold ${
          tone === "warning" ? "text-amber-800" : "text-slate-700"
        }`}
      >
        {label}
      </Text>
    </View>
  );
}

function Fact({
  icon,
  label,
  value,
  last = false,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      className={`flex-1 items-center ${last ? "" : "border-r border-slate-100"}`}
    >
      <MaterialCommunityIcons name={icon} size={18} color="#1f2937" />
      <Text className="mt-1 text-base font-semibold text-slate-900">
        {value}
      </Text>
      <Text className="mt-0.5 text-xs text-slate-500">{label}</Text>
    </View>
  );
}
