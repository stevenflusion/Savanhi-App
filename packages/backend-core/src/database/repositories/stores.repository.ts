import type { StoreRequest } from "@repo/api-contracts/products";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { AppError } from "../../errors.js";
import type { DatabaseConnection } from "../connection.js";
import { haversineMeters } from "../geo.js";
import { stores, storeFollows } from "../schema.js";
import { mapStore, type StoreDistanceRecord } from "../mappers.js";

/** The customer's own position, as the discovery reads take it (S7). */
export type GeoPoint = {
  latitude: number;
  longitude: number;
};

/** The columns a customer-facing store read returns; never a timestamp (S11). */
const customerStoreColumns = {
  id: stores.id,
  name: stores.name,
  address: stores.address,
  latitude: stores.latitude,
  longitude: stores.longitude,
};

/** The driver may hand a `double precision` back as a string; pin it to a number. */
const toMeters = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

export function createStoresRepository(db: DatabaseConnection) { return {
  async listByOwner(ownerProfileId: string) { return (await db.select().from(stores).where(eq(stores.ownerUserId, ownerProfileId)).orderBy(desc(stores.createdAt))).map(mapStore); },
  async listIdsByOwner(ownerProfileId: string) { return (await db.select({ id: stores.id }).from(stores).where(eq(stores.ownerUserId, ownerProfileId))).map((row) => row.id); },
  async createForOwner(ownerProfileId: string, payload: StoreRequest) { const [row] = await db.insert(stores).values({ ownerUserId: ownerProfileId, name: payload.name, address: payload.address ?? null, latitude: payload.latitude ?? null, longitude: payload.longitude ?? null, paymentMethod: payload.paymentMethod ?? null, bankAccountName: payload.bankAccountName ?? null, bankAccountNumber: payload.bankAccountNumber ?? null, bankAccountType: payload.bankAccountType ?? null }).returning(); if (!row) throw new AppError("Unable to create store.", 502); return mapStore(row); },
  async count() { const [result] = await db.select({ count: sql<number>`count(*)` }).from(stores); return Number(result?.count ?? 0); },

  /**
   * Active stores within `radiusMeters` of the customer, nearest first (S7).
   * A store with no coordinates is excluded rather than treated as distance
   * zero — it was never pinned on the map, so it is not “nearby” anything.
   */
  async listNearbyActive(
    point: GeoPoint,
    radiusMeters: number,
  ): Promise<StoreDistanceRecord[]> {
    const distance = haversineMeters(stores.latitude, stores.longitude, point);
    const rows = await db
      .select({ ...customerStoreColumns, distanceMeters: distance })
      .from(stores)
      .where(
        and(
          eq(stores.active, true),
          isNotNull(stores.latitude),
          isNotNull(stores.longitude),
          sql`${distance} <= ${radiusMeters}::double precision`,
        ),
      )
      .orderBy(sql`${distance} asc`, asc(stores.name));

    return rows.map((row) => ({
      ...row,
      distanceMeters: toMeters(row.distanceMeters),
    }));
  },

  /**
   * The active stores this customer follows. With a position they carry their
   * distance and sort nearest first, with the unpinned ones last, because the
   * feed merges them with the nearby stores and has to order the whole set;
   * without one they are just a list, sorted by name.
   */
  async listFollowedByCustomer(
    customerUserId: string,
    point?: GeoPoint,
  ): Promise<StoreDistanceRecord[]> {
    const distance = point
      ? haversineMeters(stores.latitude, stores.longitude, point)
      : sql<number | null>`null::double precision`;
    const rows = await db
      .select({ ...customerStoreColumns, distanceMeters: distance })
      .from(storeFollows)
      .innerJoin(stores, eq(storeFollows.storeId, stores.id))
      .where(
        and(
          eq(storeFollows.customerUserId, customerUserId),
          eq(stores.active, true),
        ),
      )
      .orderBy(
        ...(point
          ? [sql`${distance} asc nulls last`, asc(stores.name)]
          : [asc(stores.name)]),
      );

    return rows.map((row) => ({
      ...row,
      distanceMeters: toMeters(row.distanceMeters),
    }));
  },

  /**
   * Follow is idempotent (S7): the unique pair makes the second call a no-op
   * instead of a second row, so the response is the end state and never an
   * error. A store that does not exist, or that is no longer active, is a 404
   * — a customer can only follow what discovery can show.
   */
  async followForCustomer(customerUserId: string, storeId: string) {
    const [store] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(and(eq(stores.id, storeId), eq(stores.active, true)));
    if (!store) throw new AppError("Store not found.", 404);

    await db
      .insert(storeFollows)
      .values({ customerUserId, storeId })
      .onConflictDoNothing({
        target: [storeFollows.customerUserId, storeFollows.storeId],
      });
    return { storeId, following: true as const };
  },

  /**
   * Unfollow is idempotent too, and deliberately does NOT require the store to
   * be active: a customer must always be able to stop following a store, even
   * one that has since been deactivated.
   */
  async unfollowForCustomer(customerUserId: string, storeId: string) {
    const [store] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.id, storeId));
    if (!store) throw new AppError("Store not found.", 404);

    await db
      .delete(storeFollows)
      .where(
        and(
          eq(storeFollows.customerUserId, customerUserId),
          eq(storeFollows.storeId, storeId),
        ),
      );
    return { storeId, following: false as const };
  },
}; }
