import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { MobileTopBar } from "@/src/components/MobileTopBar";
import { ProductsWorkspace } from "@/src/components/ProductsWorkspace";

export default function ProductsTab() {
  const { intent, productId } = useLocalSearchParams<{
    intent?: string;
    productId?: string;
  }>();
  const router = useRouter();
  const addIntent = intent === "add";
  // `intent=edit&productId=...` is how the product detail hands the tendero
  // back to the editor this tab already owns.
  const editProductId =
    intent === "edit" && typeof productId === "string" ? productId : "";

  useEffect(() => {
    if (addIntent) router.setParams({ intent: undefined });
  }, [addIntent, router]);

  return (
    <SafeAreaView className="flex-1 bg-orange-50">
      <MobileTopBar
        title="Productos"
        subtitle="Agrega, vende y controla inventario por categoría"
      />
      <ProductsWorkspace addIntent={addIntent} editProductId={editProductId} />
    </SafeAreaView>
  );
}
