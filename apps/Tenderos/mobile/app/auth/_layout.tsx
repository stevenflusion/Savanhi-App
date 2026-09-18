import { Redirect, Stack, usePathname } from "expo-router";
import { useAuth } from "@/src/features/auth";
import { getAuthLayoutRedirect } from "@/src/features/auth/domain/auth-navigation";

export default function AuthLayout() {
  const pathname = usePathname();
  const { user, onboardingDraft, onboardingStep, isReady } = useAuth();
  if (!isReady) return null;

  const redirect = getAuthLayoutRedirect(
    pathname,
    user,
    onboardingDraft,
    onboardingStep,
  );
  if (redirect) {
    return <Redirect href={redirect as never} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
