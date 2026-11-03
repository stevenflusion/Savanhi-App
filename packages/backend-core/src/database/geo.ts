import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Great-circle distance in SQL.
 *
 * The MVP needs “within 3 km, nearest first” over a handful of stores, which
 * the haversine formula answers exactly without a PostGIS dependency: the
 * extension would have to be installed in every environment, and the
 * `stores` table already holds plain `double precision` coordinates.
 *
 * The radius is the IUGG mean Earth radius in metres. At 3 km the difference
 * against an ellipsoidal distance is well under a metre, which no screen that
 * renders “0,6 km” can show.
 */
const EARTH_RADIUS_METERS = 6_371_008.8;

/**
 * Distance in metres between a stored coordinate pair and a given point. The
 * result is `null` when the store has no coordinates, so a store that was
 * never pinned on the map simply has no distance rather than a wrong one.
 */
export function haversineMeters(
  latitudeColumn: PgColumn,
  longitudeColumn: PgColumn,
  point: { latitude: number; longitude: number },
): SQL<number | null> {
  // Every bound value is cast explicitly. Postgres infers a placeholder's type
  // from its context, and `$1 * 2` next to an integer literal resolves to
  // `integer`, which rejects the radius outright with "invalid input syntax
  // for type integer".
  const radius = sql`${EARTH_RADIUS_METERS}::double precision`;
  const latitude = sql`${point.latitude}::double precision`;
  const longitude = sql`${point.longitude}::double precision`;

  // The CASE is not defensive dressing, it is required: `least()` IGNORES null
  // arguments rather than propagating them, so `least(1, null)` is 1 and an
  // unpinned store would measure asin(1) — half the Earth's circumference —
  // instead of having no distance at all. Guarding here keeps `least` for what
  // it is good at: clamping floating-point drift back into asin's domain.
  return sql<number | null>`
    case
      when ${latitudeColumn} is null or ${longitudeColumn} is null then null
      else ${radius} * 2 * asin(
        least(
          1::double precision,
          sqrt(
            power(sin(radians(${latitudeColumn} - ${latitude}) / 2), 2)
            + cos(radians(${latitude}))
              * cos(radians(${latitudeColumn}))
              * power(sin(radians(${longitudeColumn} - ${longitude}) / 2), 2)
          )
        )
      )
    end
  `;
}
