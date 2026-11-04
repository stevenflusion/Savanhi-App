import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProductDetailScreen } from "@/src/features/products/presentation/screens/ProductDetailScreen";

/**
 * The product detail, OUTSIDE the tabs: it is pushed over the products
 * workspace and carries its own back button, so it must not become another
 * destination in the floating bar.
 *
 * The id travels in the path and is never rendered (S11).
 */
export default function ProductDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();

  return (
    <SafeAreaView className="flex-1 bg-orange-50">
      <ProductDetailScreen productId={typeof id === "string" ? id : ""} />
    </SafeAreaView>
  );
}
