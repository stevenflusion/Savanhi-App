import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Image, Text, View } from "react-native";

/**
 * Who the tendero is, at the top of the Home tab (S14): the store's own photo,
 * its name and where it is.
 *
 * There is no notification bell. The reference shows one; this app has no
 * notifications to put behind it, and a bell that never has anything to say is
 * a promise the product does not keep.
 *
 * The photo falls back twice, never to a placeholder image: the store's
 * initial first — which is already how the Perfil tab draws an account with no
 * picture — and a storefront icon when there is not even a name to take an
 * initial from.
 */
export function HomeHeader({
  storeName,
  photoUrl,
  locationLabel,
}: {
  storeName: string;
  photoUrl: string | null;
  /** Empty when the store was never pinned and has no written address. */
  locationLabel: string;
}) {
  const initial = storeName.trim().charAt(0).toUpperCase();

  return (
    <View className="w-full max-w-xl flex-row items-center gap-3 self-center">
      {photoUrl ? (
        <Image
          testID="store-photo"
          source={{ uri: photoUrl }}
          className="h-14 w-14 rounded-full"
        />
      ) : initial ? (
        <View
          testID="store-initial"
          className="h-14 w-14 items-center justify-center rounded-full bg-black"
        >
          <Text className="text-xl font-semibold text-[#fef7ee]">
            {initial}
          </Text>
        </View>
      ) : (
        <View
          testID="store-icon"
          className="h-14 w-14 items-center justify-center rounded-full bg-slate-100"
        >
          <MaterialCommunityIcons name="storefront-outline" size={26} color="#1f2937" />
        </View>
      )}

      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={1}
          className="text-lg font-semibold text-slate-900"
        >
          {storeName}
        </Text>
        <View className="mt-0.5 flex-row items-center gap-1">
          <MaterialCommunityIcons
            name="map-marker-outline"
            size={14}
            color="#64748b"
          />
          <Text numberOfLines={1} className="flex-1 text-sm text-slate-500">
            {locationLabel || "Agrega la ubicación de tu tienda"}
          </Text>
        </View>
      </View>
    </View>
  );
}
