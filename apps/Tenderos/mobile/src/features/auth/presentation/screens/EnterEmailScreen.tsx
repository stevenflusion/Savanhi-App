import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useAuth } from "@/src/features/auth";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  Keyboard,
  KeyboardEvent,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import authLogo from "../assets/auth-logo";
import type { OtpAuthState } from "@repo/api-contracts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EnterEmailScreen() {
  const { requestOTP } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpState, setOtpState] = useState<OtpAuthState | null>(null);
  const [error, setError] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const valid = EMAIL_RE.test(email);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e: KeyboardEvent) => setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardHeight(0),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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

  const handleBack = () => {
    Keyboard.dismiss();
    setTimeout(() => router.back(), 50);
  };

  const handleSubmit = async () => {
    if (!valid || loading) return;
    Keyboard.dismiss();
    setOtpState("sending");
    setLoading(true);
    setError("");
    const result = await requestOTP(email);
    setOtpState(result.state ?? "provider_error");
    if (result.success && result.challengeId) {
      router.push(
        `/auth/enter-otp?email=${encodeURIComponent(email)}&challengeId=${encodeURIComponent(result.challengeId)}&cooldownSeconds=${result.cooldownSeconds ?? 0}`,
      );
      setTimeout(() => setLoading(false), 400);
    } else {
      setLoading(false);
      setError(result.error ?? "Error al enviar código");
    }
  };

  return (
    <View className="flex-1 bg-white">
      <Animated.View
        className="flex-1"
        style={{
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
          paddingBottom: keyboardHeight,
        }}
      >
        <View className="flex-1 px-6" style={{ paddingTop: insets.top + 24 }}>
          <Pressable
            onPress={handleBack}
            className="mb-10 h-10 w-10 justify-center"
          >
            <FontAwesome6 name="chevron-left" size={24} color="black" />
          </Pressable>

          <Text className="text-4xl pb-10 font-medium text-gray-900">
            ¿Cuál es tu dirección de correo electrónico?
          </Text>

          <TextInput
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (error) setError("");
            }}
            placeholder="Introduce tu correo electrónico"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            keyboardType="email-address"
            autoFocus
            className="h-16 px-4 border rounded-2xl border-gray-900 text-lg  text-gray-900"
          />

          {error ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              className="text-base pt-4 leading-5 text-red-400"
            >
              {error}
            </Text>
          ) : (
            <Text className="text-base pt-4 leading-5 text-gray-600">
              Te enviaremos un código para verificar tu email. Es posible que
              debas revisar tu carpeta de correo no deseado
            </Text>
          )}
        </View>

        <View className="px-6" style={{ paddingBottom: insets.bottom + 16 }}>
          <Pressable
            onPress={handleSubmit}
            disabled={!valid || loading}
            accessibilityState={{ disabled: !valid || loading, busy: loading }}
            accessibilityValue={otpState ? { text: otpState } : undefined}
            className={`h-16 items-center justify-center rounded-full ${
              valid ? "bg-black" : "bg-gray-100"
            }`}
          >
            <Text
              className={`text-lg ${
                valid && !loading ? "text-white" : "text-gray-400"
              }`}
            >
              Siguiente
            </Text>
          </Pressable>

          <Text className="text-center flex items-center justify-center text-sm pt-4">
            <MaterialIcons name="lock" size={12} color="black" /> Nunca
            compartiremos tu email con nadie
          </Text>
        </View>
      </Animated.View>

      {loading && (
        <View className="absolute inset-0 z-50">
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
