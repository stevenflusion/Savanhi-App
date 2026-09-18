import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { normalizeOtpCode } from "../../application/otp-flow";

type Props = {
  value: string;
  onChange: (code: string) => void;
  error?: string;
};

const CELLS = 6;

export default function OtpInput({ value, onChange, error }: Props) {
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <View>
      <Pressable onPress={() => inputRef.current?.focus()}>
        <View
          className="flex-row justify-center gap-3"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          {Array.from({ length: CELLS }, (_, i) => (
            <View
              key={i}
              className={`h-16 w-14 items-center justify-center rounded-2xl border ${
                error ? "border-red-400" : "border-gray-900"
              }`}
            >
              <Text className="text-2xl font-medium text-gray-600">
                {value[i] ?? ""}
              </Text>
            </View>
          ))}
        </View>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(text) => onChange(normalizeOtpCode(text))}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          accessibilityLabel="Código de verificación de 6 dígitos"
          accessibilityHint="Pega o escribe el código recibido por correo"
          accessibilityValue={{
            text: `${value.length} de 6 dígitos ingresados`,
          }}
          style={[StyleSheet.absoluteFillObject, styles.hiddenInput]}
        />
      </Pressable>
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          className="text-sm pt-4 ml-4 leading-5 text-red-400"
        >
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={18}
            color="#f87171"
          />{" "}
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hiddenInput: {
    color: "transparent",
    opacity: 0.02,
  },
});
