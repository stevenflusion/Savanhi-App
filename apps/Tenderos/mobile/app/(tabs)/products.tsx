import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { MobileTopBar } from "@/src/components/MobileTopBar";
import { ProductsWorkspace } from "@/src/components/ProductsWorkspace";

export default function ProductsTab() {
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const router = useRouter();
  const addIntent = intent === "add";

  useEffect(() => {
    if (addIntent) router.setParams({ intent: undefined });
  }, [addIntent, router]);

  return (
    <SafeAreaView className="flex-1 bg-orange-50">
      <MobileTopBar
        title="Productos"
        subtitle="Agrega, vende y controla inventario por categoria"
      />
      <ProductsWorkspace addIntent={addIntent} />
    </SafeAreaView>
  );
}
