import AntDesign from "@expo/vector-icons/AntDesign";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Image, Keyboard, Pressable, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/features/auth";

import authLogo from "../assets/auth-logo";

export default function AccountCreatedScreen() {
  const router = useRouter();
  const { completeRegistration } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const [keyboardHeight] = useState(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleStart = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    const result = await completeRegistration();
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo completar el registro.");
    }
  };

  const handleBack = () => {
    Keyboard.dismiss();
    setTimeout(() => router.back(), 50);
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <Animated.View
        className="flex-1"
        style={{
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
          paddingBottom: keyboardHeight,
        }}
      >
        <View className="flex-1 px-6" style={{ paddingTop: insets.top }}>
          <Pressable onPress={handleBack} className="mb-10 h-10 w-10 justify-center">
            <AntDesign name="close" size={26} color="black" />
          </Pressable>

          <View className="flex gap-1">
            <Image source={authLogo} className="h-16 w-16" resizeMode="cover" />
            <Text className="mt-6 text-4xl text-gray-900">
              Te damos la bienvenida a Savanhi.
            </Text>
            <Text className="flex justify-center pb-4 text-base text-gray-400">
              Por favor, sigue estas normas
            </Text>

            <View className="flex gap-1 pb-4">
              <Text className="flex justify-center text-lg text-gray-900">
                Mantén tu información actualizada.
              </Text>
              <Text className="flex justify-center text-base text-gray-400 -pt-4">
                Asegúrate de que el nombre, dirección, horarios y datos de
                contacto sean correctos.
              </Text>
            </View>
            <View className="flex gap-1 pb-4">
              <Text className="flex justify-center text-lg text-gray-900">
                Usa fotos reales.
              </Text>
              <Text className="flex justify-center text-base text-gray-400 -pt-4">
                Comparte imágenes claras y actuales de tu local y de tus
                productos para generar confianza.
              </Text>
            </View>
            <View className="flex gap-1 pb-4">
              <Text className="flex justify-center text-lg text-gray-900">
                Brinda una buena atención.
              </Text>
              <Text className="flex justify-center text-base text-gray-400 -pt-4">
                Responde los pedidos y consultas lo antes posible para ofrecer
                una mejor experiencia a tus clientes.
              </Text>
            </View>
            <View className="flex gap-1 pb-4">
              <Text className="flex justify-center text-lg text-gray-900">
                Mantén tu catálogo al día.
              </Text>
              <Text className="flex justify-center text-base text-gray-400 -pt-4">
                Actualiza los productos, precios y disponibilidad para evitar
                inconvenientes con los pedidos.
              </Text>
            </View>
          </View>
        </View>
      </Animated.View>

      <View className="px-6 pb-4">
        {error ? <Text className="mb-3 text-center text-sm text-red-600">{error}</Text> : null}
        <Pressable
          onPress={handleStart}
          disabled={loading}
          className="h-16 items-center justify-center rounded-full bg-black"
        >
          <Text className="text-lg text-white">
            {loading ? "Creando tu cuenta..." : "Comenzar"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
