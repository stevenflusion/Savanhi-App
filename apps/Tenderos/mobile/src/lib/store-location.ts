import * as Location from "expo-location";

import { MAPBOX_ACCESS_TOKEN } from "./mapbox";

/**
 * The short "where the store is" line, in ONE place.
 *
 * This is the derivation the Perfil tab had been doing inline since before the
 * coupons feature existed: Mapbox reverse geocoding first, the device's own
 * reverse geocoder second, and the stored address's last two segments as the
 * final fallback. It was lifted here verbatim so the Home header shows exactly
 * what the Perfil tab shows — the alternative was a SECOND geocoding path
 * answering a slightly different label for the same coordinates.
 *
 * T14 moved the Perfil tab onto it, so the inline copy is gone and this is now
 * the ONLY geocoding path in the app. Both callers — the Home header and the
 * Perfil header — go through this function; nothing else reverse-geocodes.
 */
export type StoreLocationSource = {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type MapboxPlaceFeature = {
  properties?: {
    feature_type?: string;
    name?: string;
  };
};

/** The two last segments of a written address, e.g. `Quito, Ecuador`. */
export function addressFallbackLabel(
  address: string | null | undefined,
): string {
  if (!address) return "";
  return address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(-2)
    .join(", ");
}

/**
 * A neighbourhood-level name, skipping the administrative labels that are
 * true but useless to a tendero ("Distrito Metropolitano ..." names the whole
 * city they already know they are in).
 */
const isUsefulNeighborhood = (name: string | undefined, kind: string) =>
  ["neighborhood", "locality", "district"].includes(kind) &&
  Boolean(name) &&
  !/^distrito metropolitano/i.test(name ?? "");

async function fromMapbox(
  latitude: number,
  longitude: number,
): Promise<string> {
  if (!MAPBOX_ACCESS_TOKEN) return "";
  try {
    const url = new URL("https://api.mapbox.com/search/geocode/v6/reverse");
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set(
      "types",
      "neighborhood,locality,district,place,country",
    );
    url.searchParams.set("language", "es");
    url.searchParams.set("access_token", MAPBOX_ACCESS_TOKEN);

    const response = await fetch(url.toString());
    if (!response.ok) return "";

    const result = (await response.json()) as {
      features?: MapboxPlaceFeature[];
    };
    const features = result.features ?? [];
    const named = (kind: string) =>
      features.find((feature) => feature.properties?.feature_type === kind)
        ?.properties?.name ?? "";

    const place = named("place");
    const country = named("country");
    const neighborhood = features.find((feature) =>
      isUsefulNeighborhood(
        feature.properties?.name,
        feature.properties?.feature_type ?? "",
      ),
    )?.properties?.name;

    if (neighborhood && place) return `${place}, ${neighborhood}`;
    if (place && country) return `${place}, ${country}`;
    return place || country;
  } catch {
    return "";
  }
}

async function fromDevice(
  latitude: number,
  longitude: number,
): Promise<string> {
  try {
    const [address] = await Location.reverseGeocodeAsync({
      latitude,
      longitude,
    });
    const city = address?.city;
    const country = address?.country;
    const region = address?.region;
    const neighborhood = [address?.subregion, address?.district].find(
      (place) =>
        place &&
        place !== city &&
        place !== country &&
        place !== region &&
        !/distrito metropolitano/i.test(place),
    );

    if (city && neighborhood) return `${city}, ${neighborhood}`;
    if (city && country) return `${city}, ${country}`;
    return city || country || "";
  } catch {
    return "";
  }
}

/**
 * The store's location as one short line, or an empty string when nothing is
 * known. An empty answer is a real state — a store that was never pinned and
 * has no written address — and the screen words it, not this module.
 */
export async function resolveStoreLocationLabel(
  store: StoreLocationSource | null | undefined,
): Promise<string> {
  if (!store) return "";

  const { latitude, longitude } = store;
  if (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  ) {
    const mapbox = await fromMapbox(latitude, longitude);
    if (mapbox) return mapbox;

    const device = await fromDevice(latitude, longitude);
    if (device) return device;
  }

  return addressFallbackLabel(store.address);
}
