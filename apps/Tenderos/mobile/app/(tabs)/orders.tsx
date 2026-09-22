import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MobileTopBar } from "@/src/components/MobileTopBar";

export default function OrdersTab() {
  return (
    <SafeAreaView className="flex-1 bg-orange-50">
      <MobileTopBar
        title="Pedidos"
        subtitle="Consulta el estado de esta funcionalidad"
      />
      <View className="flex-1 items-center justify-center px-4">
        <View className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Text className="text-lg font-semibold text-slate-900">
            Pedidos aún no está disponible
          </Text>
          <Text className="mt-2 text-sm leading-5 text-slate-600">
            La gestión de pedidos se incorporará en una próxima actualización.
            Por ahora, puedes administrar tus productos e inventario.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
