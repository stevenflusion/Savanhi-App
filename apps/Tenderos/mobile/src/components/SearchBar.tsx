import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { TextInput, View } from "react-native";

type SearchBarProps = {
  value: string;
  onChangeText: (value: string) => void;
};

/** The search field as the rounded white pill the rest of the app uses (S14). */
export function SearchBar({ value, onChangeText }: SearchBarProps) {
  return (
    <View className="w-full flex-row items-center gap-2 rounded-full bg-white px-4 py-3 shadow-sm">
      <MaterialCommunityIcons name="magnify" size={20} color="#94a3b8" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Buscar por nombre o categoría"
        placeholderTextColor="#94a3b8"
        className="flex-1 text-slate-900"
        accessibilityLabel="Buscar productos"
      />
    </View>
  );
}
