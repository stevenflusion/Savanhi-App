import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Image, Text, View } from "react-native";

/**
 * Who the tendero is, at the top of the Perfil tab (S14).
 *
 * It is the Home header's language — the store's own photo, its name and
 * where it is — composed for a profile instead of a toolbar: centred, larger,
 * and carrying the owner's name under the store's. The Home header is a
 * compact row inside a scrolling dashboard and cannot be reused as-is without
 * making one of the two screens wrong, so the two share the RULES (photo,
 * then initial, then a storefront icon; the location through the one shared
 * module) rather than the layout.
 *
 * S11: nothing here comes from an id.
 */
export function ProfileHeader({
  title,
  subtitle,
  photoUrl,
  locationLabel,
}: {
  /** The store's name, or the tendero's own when registration has no store. */
  title: string;
  /** The owner's name, shown only when it is not already the title. */
  subtitle: string;
  photoUrl: string | null;
  /** Empty when the store was never pinned and has no written address. */
  locationLabel: string;
}) {
  const initial = title.trim().charAt(0).toUpperCase();

  return (
    <View className="items-center">
      {photoUrl ? (
        <Image
          testID="store-photo"
          source={{ uri: photoUrl }}
          className="h-24 w-24 rounded-full"
        />
      ) : initial ? (
        <View
          testID="store-initial"
          className="h-24 w-24 items-center justify-center rounded-full bg-black"
        >
          <Text className="text-3xl font-medium text-[#fef7ee]">{initial}</Text>
        </View>
      ) : (
        <View
          testID="store-icon"
          className="h-24 w-24 items-center justify-center rounded-full bg-slate-100"
        >
          <MaterialCommunityIcons
            name="storefront-outline"
            size={40}
            color="#1f2937"
          />
        </View>
      )}

      <Text className="mt-5 text-center text-3xl font-semibold tracking-tight text-slate-900">
        {title}
      </Text>

      {subtitle ? (
        <Text className="mt-1 text-base text-slate-500">{subtitle}</Text>
      ) : null}

      <View className="mt-4 max-w-full flex-row items-center rounded-full bg-white px-4 py-2 shadow-sm">
        <MaterialCommunityIcons
          name="map-marker-outline"
          size={16}
          color="#64748b"
        />
        <Text numberOfLines={1} className="ml-2 flex-shrink text-sm text-slate-600">
          {locationLabel || "Agrega la ubicación de tu tienda"}
        </Text>
      </View>
    </View>
  );
}
