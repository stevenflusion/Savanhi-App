import Constants from "expo-constants";

/**
 * The PUBLIC Mapbox access token (`pk.…`), loaded from the Expo config `extra`
 * that `app.config.js` fills from the environment. It is never hardcoded and
 * never stored. An empty string means the build has no token, which the Mapa
 * screen reports instead of drawing a map that cannot load tiles.
 */
export function getMapboxAccessToken(): string {
  const token = Constants.expoConfig?.extra?.MAPBOX_ACCESS_TOKEN;
  return typeof token === "string" ? token.trim() : "";
}
