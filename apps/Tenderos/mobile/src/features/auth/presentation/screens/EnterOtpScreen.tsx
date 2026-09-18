import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/src/features/auth";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  SafeAreaView,
  Text,
  View,
} from "react-native";
import OtpInput from "../components/OtpInput";
import authLogo from "../assets/auth-logo";
import type { OtpAuthState } from "@repo/api-contracts";
import {
  createSynchronousLock,
  getOtpDeadline,
  getOtpFailureMessage,
  type OtpFailureState,
} from "../../application/otp-flow";

export default function EnterOtpScreen() {
  const {
    email,
    challengeId: initialChallengeId,
    cooldownSeconds,
  } = useLocalSearchParams<{
    email?: string;
    challengeId?: string;
    cooldownSeconds?: string;
  }>();
  const { verifyOTP, requestOTP } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [otpState, setOtpState] = useState<OtpAuthState>("sent");
  const [resending, setResending] = useState(false);
  const [challengeId, setChallengeId] = useState(initialChallengeId ?? "");
  const [resendDeadline, setResendDeadline] = useState(
    () => Date.now() + Math.max(0, Number(cooldownSeconds) || 0) * 1000,
  );
  const resendDeadlineRef = useRef(resendDeadline);
  const [countdown, setCountdown] = useState(() =>
    Math.max(0, Math.ceil((resendDeadline - Date.now()) / 1000)),
  );
  const [showChangeEmailModal, setShowChangeEmailModal] = useState(false);
  const verifyingRef = useRef(false);
  const resendLock = useRef(createSynchronousLock()).current;

  const updateResendDeadline = (deadline: number) => {
    resendDeadlineRef.current = deadline;
    setResendDeadline(deadline);
  };

  useEffect(() => {
    if (!email || !initialChallengeId) {
      router.replace("/auth/enter-email");
    }
  }, [email, initialChallengeId, router]);

  useEffect(() => {
    const updateCountdown = () =>
      setCountdown(
        Math.max(0, Math.ceil((resendDeadline - Date.now()) / 1000)),
      );
    updateCountdown();
    if (resendDeadline <= Date.now()) return;
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [resendDeadline]);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  useEffect(() => {
    if (code.length === 6 && !loading && !verifyingRef.current) {
      handleVerify();
    }
  }, [code]);

  useEffect(() => {
    const announcement = error || feedback;
    if (announcement) AccessibilityInfo.announceForAccessibility(announcement);
  }, [error, feedback]);

  const handleVerify = async () => {
    if (loading || verifyingRef.current) return;
    if (!challengeId) {
      setError("El código ya no está disponible. Solicita uno nuevo.");
      setCode("");
      return;
    }
    Keyboard.dismiss();
    verifyingRef.current = true;
    setLoading(true);
    setError("");
    setFeedback("");
    try {
      const result = await verifyOTP(email ?? "", challengeId, code);

      if (result.success) {
        if (result.user?.registrationStatus === "completed") {
          router.replace("/(tabs)");
        } else if (result.user?.registrationStatus === "store_required") {
          router.replace("/auth/store-name" as any);
        } else {
          router.replace("/auth/person-name" as any);
        }
      } else {
        const state = result.state ?? "provider_error";
        setOtpState(state);
        setError(getOtpFailureMessage(state as OtpFailureState, result.error));
        setCode("");
      }
    } catch {
      setOtpState("provider_error");
      setError("No pudimos guardar tu sesión. Solicita un código nuevo.");
      setCode("");
    } finally {
      verifyingRef.current = false;
      setLoading(false);
    }
  };

  const handleBack = () => {
    Keyboard.dismiss();
    setTimeout(() => router.back(), 50);
  };

  const handleResend = async () => {
    if (Date.now() < resendDeadlineRef.current || !resendLock.tryAcquire()) {
      return;
    }
    setResending(true);
    setOtpState("sending");
    setError("");
    setFeedback("");
    setCode("");
    try {
      const result = await requestOTP(email ?? "");
      setOtpState(result.state ?? "provider_error");
      const deadline = getOtpDeadline(Date.now(), result);
      if (deadline > Date.now()) updateResendDeadline(deadline);
      if (result.success && result.challengeId) {
        setChallengeId(result.challengeId);
        setFeedback("Te enviamos un nuevo código.");
        return;
      }
      const state = result.state ?? "provider_error";
      setError(getOtpFailureMessage(state as OtpFailureState, result.error));
    } finally {
      resendLock.release();
      setResending(false);
    }
  };

  return (
    <View className="flex-1">
      <SafeAreaView className="flex-1 bg-white">
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <Animated.View
            className="flex-1"
            style={{
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            }}
          >
            <View className="flex-1 px-6 pt-10">
              <Pressable
                onPress={handleBack}
                accessibilityRole="button"
                accessibilityLabel="Volver"
                className="mb-10 h-10 w-10 justify-center"
              >
                <FontAwesome6 name="chevron-left" size={24} color="black" />
              </Pressable>
              <Text className="text-4xl pb-5 font-medium text-gray-900">
                Ingresa tu codigo de verificación
              </Text>
              <Text className="text-base pt-4 leading-5 text-gray-600">
                Te enviamos tu código a {email}. Revísalo e introdúcelo a
                continuación.{" "}
                <Text
                  onPress={() => setShowChangeEmailModal(true)}
                  accessibilityRole="link"
                  accessibilityLabel="Cambiar dirección de email"
                  className="underline text-gray-900"
                >
                  Cambiar dirección de email
                </Text>
              </Text>

              <View className="mt-8 pb-8">
                <OtpInput
                  value={code}
                  onChange={(v) => {
                    setCode(v);
                    setFeedback("");
                    if (error) setError("");
                  }}
                  error={error}
                />
                {feedback ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    className="pt-4 text-center text-sm leading-5 text-gray-600"
                  >
                    {feedback}
                  </Text>
                ) : null}
              </View>

              {countdown > 0 ? (
                <Text className="text-sm text-center leading-5 text-gray-600">
                  Recibirás el código dentro de {countdown} seg. Quizá necesites
                  revisar tu carpeta de correo no deseado
                </Text>
              ) : (
                <Pressable
                  onPress={handleResend}
                  disabled={resending}
                  accessibilityRole="button"
                  accessibilityLabel="Reenviar código"
                  accessibilityState={{ disabled: resending, busy: resending }}
                  accessibilityValue={{ text: otpState }}
                >
                  <Text className="underline text-center text-lg font-medium text-gray-900">
                    ¿Aún no has recibido el mensaje?
                  </Text>
                </Pressable>
              )}
            </View>
            <Text className="text-center flex items-center justify-center text-sm pb-4">
              <Ionicons name="alert-circle-sharp" size={14} color="black" /> El
              codigo recibido es unico no lo compartas
            </Text>
          </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal
        visible={showChangeEmailModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowChangeEmailModal(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/50 px-6">
          <View className="w-full items-center rounded-2xl bg-white px-6 pb-6 pt-8">
            <MaterialCommunityIcons
              name="email-edit-outline"
              size={34}
              color="black"
            />
            <Text className="text-2xl text-center py-5 font-medium text-[#25262a]">
              ¿Deseas cambiar el correo?
            </Text>
            <Text className="text-base text-center leading-6 text-gray-600">
              Si cambiás de correo, tendrás que pedir un nuevo código.
            </Text>

            <View className="mt-8 w-full flex-row gap-3">
              <Pressable
                onPress={() => setShowChangeEmailModal(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancelar cambio de correo"
                className="flex-1 h-14 items-center justify-center rounded-full bg-gray-100"
              >
                <Text className="text-base text-gray-700">Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setShowChangeEmailModal(false);
                  router.push("/auth/enter-email");
                }}
                accessibilityRole="button"
                accessibilityLabel="Cambiar correo"
                className="flex-1 h-14 items-center justify-center rounded-full bg-gray-900"
              >
                <Text className="text-base text-white">Cambiar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {loading && (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Verificando código"
          className="absolute inset-0 z-50"
        >
          <View className="flex-1 items-center justify-center bg-white">
            <Image
              source={authLogo}
              className="h-40 w-40"
              resizeMode="contain"
            />
          </View>
        </View>
      )}
    </View>
  );
}
