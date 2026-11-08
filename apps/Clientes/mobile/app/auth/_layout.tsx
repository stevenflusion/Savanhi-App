import { Stack } from "expo-router";

import { AuthGuard } from "@/src/features/auth";

export default function AuthLayout() {
  return (
    <AuthGuard area="auth">
      <Stack screenOptions={{ headerShown: false }} />
    </AuthGuard>
  );
}
