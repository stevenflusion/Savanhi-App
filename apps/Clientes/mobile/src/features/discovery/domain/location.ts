/** A device position as the customer API expects it, in decimal degrees. */
export type Coordinates = { latitude: number; longitude: number };

/** What the operating system says about the foreground location permission. */
export type LocationPermission = "undetermined" | "granted" | "denied";

const inRange = (value: unknown, limit: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;

export function isCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== "object" || value === null) return false;
  const { latitude, longitude } = value as Record<string, unknown>;
  return inRange(latitude, 90) && inRange(longitude, 180);
}

/**
 * Six decimals (about ten centimetres) is far finer than a 3 km search needs.
 * `toFixed` never produces an exponent, which the API's coordinate grammar
 * rejects, and the rounded pair is what is both sent and compared.
 */
export const formatCoordinate = (value: number): string => value.toFixed(6);

export function roundCoordinates({ latitude, longitude }: Coordinates) {
  return {
    latitude: Number(formatCoordinate(latitude)),
    longitude: Number(formatCoordinate(longitude)),
  };
}

/** A stable identity for a position, `none` when there is no position. */
export const coordinatesKey = (coordinates: Coordinates | null): string =>
  coordinates
    ? `${formatCoordinate(coordinates.latitude)},${formatCoordinate(coordinates.longitude)}`
    : "none";

/** The `lat`/`lng` pair, always both and never anything else. */
export const coordinatesQuery = ({ latitude, longitude }: Coordinates) =>
  `?lat=${formatCoordinate(latitude)}&lng=${formatCoordinate(longitude)}`;
