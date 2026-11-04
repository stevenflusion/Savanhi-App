import { SafeAreaView } from "react-native-safe-area-context";

import { MobileTopBar } from "@/src/components/MobileTopBar";
import { ProfileScreen } from "@/src/features/profile/presentation/screens/ProfileScreen";

export default function ProfileTab() {
  return (
    <SafeAreaView className="flex-1 bg-orange-50">
      <MobileTopBar title="Perfil" subtitle="Tu negocio, de un vistazo" />
      <ProfileScreen />
    </SafeAreaView>
  );
}
