import { SafeAreaView } from "react-native-safe-area-context";
import { MobileTopBar } from "@/src/components/MobileTopBar";
import { CouponsScreen } from "@/src/features/coupons/presentation/screens/CouponsScreen";

export default function CouponsTab() {
  return (
    <SafeAreaView className="flex-1 bg-orange-50">
      <MobileTopBar
        title="Cupones"
        subtitle="Crea, pausa y edita las promociones de tu tienda"
      />
      <CouponsScreen />
    </SafeAreaView>
  );
}
