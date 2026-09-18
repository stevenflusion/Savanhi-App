import { Redirect } from "expo-router";
import { useAuth } from "@/src/features/auth";
import { getCanonicalAuthPath } from "@/src/features/auth/domain/auth-navigation";

export default function IndexScreen() {
  const { user, onboardingDraft, onboardingStep, isReady } = useAuth();
  if (!isReady) return null;
  return (
    <Redirect
      href={
        getCanonicalAuthPath(user, onboardingDraft, onboardingStep) as never
      }
    />
  );
}
