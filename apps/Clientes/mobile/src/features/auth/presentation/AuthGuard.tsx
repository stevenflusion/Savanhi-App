import { Redirect, usePathname } from "expo-router";
import type { ReactNode } from "react";
import { Image, View } from "react-native";

import { getGateRedirect, type GateArea } from "../domain/profile-gate";
import { useAuth } from "./AuthProvider";
import authLogo from "./assets/auth-logo";

type Props = { area: GateArea; children: ReactNode };

/**
 * Wraps a route group. Nothing protected is rendered until the server says the
 * customer is eligible and named; while the session is restored the guard
 * shows nothing, so no screen flashes before the gate decides.
 */
export function AuthGuard({ area, children }: Props) {
  const { gate, isReady } = useAuth();
  const pathname = usePathname();

  if (gate.status === "loading") {
    if (!isReady) return null;
    if (area === "auth") return <>{children}</>;
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <Image source={authLogo} className="h-40 w-40" resizeMode="contain" />
      </View>
    );
  }

  const href = getGateRedirect(area, gate, pathname);
  if (href) return <Redirect href={href as never} />;

  return <>{children}</>;
}
