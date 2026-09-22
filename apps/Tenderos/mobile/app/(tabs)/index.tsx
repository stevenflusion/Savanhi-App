import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AlertsCard } from "@/src/components/AlertsCard";
import { DashboardStatCard } from "@/src/components/DashboardStatCard";
import { MobileTopBar } from "@/src/components/MobileTopBar";
import { QuickActionsCard } from "@/src/components/QuickActionsCard";
import { TopProductsCard } from "@/src/components/TopProductsCard";

const topProducts = [
  { id: "1", name: "Arroz 1kg", sold: 42 },
  { id: "2", name: "Aceite 900ml", sold: 31 },
  { id: "3", name: "Gaseosa 500ml", sold: 27 },
];

const importantAlerts = [
  {
    id: "1",
    label: "3 productos con stock critico (<= 2 unidades)",
    tone: "amber" as const,
  },
  {
    id: "2",
    label: "2 productos agotados requieren reposicion hoy",
    tone: "rose" as const,
  },
  {
    id: "3",
    label: "Cierre de caja recomendado antes de las 9:00 PM",
    tone: "sky" as const,
  },
];

export default function HomeTab() {
  const router = useRouter();

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 320,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, slide]);

  return (
    <SafeAreaView className="flex-1 bg-orange-50">
      <MobileTopBar
        title="Tu tienda hoy"
        subtitle="Control rapido de ventas, stock y alertas"
      />
      <Animated.View
        className="flex-1"
        style={{ opacity: fade, transform: [{ translateY: slide }] }}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 24,
            gap: 12,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View className="w-full max-w-xl self-center rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <Text className="text-lg font-semibold text-emerald-900">
              Resumen del dia
            </Text>
            <Text className="mt-2 text-emerald-800">
              Informacion clave para decidir rapido que reponer, vender y
              revisar.
            </Text>
          </View>

          <View className="w-full max-w-xl self-center flex-row flex-wrap gap-2">
            <DashboardStatCard
              title="Ventas del dia"
              value="$ 356.80"
              subtitle="+12% vs ayer"
              icon="VEN"
              tone="blue"
            />
            <DashboardStatCard
              title="Ganancia estimada"
              value="$ 97.20"
              subtitle="Margen promedio 27%"
              icon="GAN"
              tone="green"
            />
          </View>

          <View className="w-full max-w-xl self-center flex-row flex-wrap gap-2">
            <DashboardStatCard
              title="Productos vendidos"
              value="126"
              subtitle="Movimientos del dia"
              icon="PDV"
              tone="violet"
            />
            <DashboardStatCard
              title="Bajo stock"
              value="3"
              subtitle="Reponer hoy"
              icon="BST"
              tone="amber"
            />
          </View>

          <View className="w-full max-w-xl self-center flex-row flex-wrap gap-2">
            <DashboardStatCard
              title="Agotados"
              value="2"
              subtitle="Sin unidades disponibles"
              icon="AGT"
              tone="rose"
            />
          </View>

          <QuickActionsCard
            actions={[
              {
                id: "add",
                label: "Agregar producto",
                icon: "NVO",
                onPress: () => router.push("/products?intent=add" as never),
              },
              {
                id: "sale",
                label: "Registrar venta",
                icon: "VTA",
                onPress: () => router.push("/products" as never),
              },
              {
                id: "inventory",
                label: "Revisar inventario",
                icon: "STK",
                onPress: () => router.push("/products" as never),
              },
            ]}
          />

          <TopProductsCard products={topProducts} />
          <AlertsCard alerts={importantAlerts} />
        </ScrollView>
      </Animated.View>
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}
