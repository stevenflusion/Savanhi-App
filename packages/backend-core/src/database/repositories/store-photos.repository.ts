import type { StorePhotoRegisterRequest } from "@repo/api-contracts";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "../../errors.js";
import type { DatabaseConnection } from "../connection.js";
import { mapStorePhoto } from "../mappers.js";
import { storePhotos } from "../schema.js";

export function createStorePhotosRepository(db: DatabaseConnection) {
  return {
    async listByStoreIds(storeIds: string[]) {
      if (!storeIds.length) return [];
      return (
        await db
          .select()
          .from(storePhotos)
          .where(inArray(storePhotos.storeId, storeIds))
          .orderBy(asc(storePhotos.position), asc(storePhotos.createdAt))
      ).map(mapStorePhoto);
    },

    /**
     * Appends the photo after the store's existing ones. The position comes
     * from the stored rows, never from the client, so two devices registering
     * at once cannot claim the same slot by sending the same number.
     */
    async createForStore(storeId: string, payload: StorePhotoRegisterRequest) {
      let row: typeof storePhotos.$inferSelect | undefined;
      try {
        [row] = await db
          .insert(storePhotos)
          .values({
            storeId,
            objectKey: payload.objectKey,
            contentType: payload.contentType,
            byteSize: payload.byteSize,
            position: sql`(select coalesce(max(${storePhotos.position}) + 1, 0) from ${storePhotos} where ${storePhotos.storeId} = ${storeId})`,
          })
          .returning();
      } catch (error) {
        // 23505 is PostgreSQL's unique_violation; the driver error must not
        // reach the HTTP boundary. Drizzle wraps it, so the code can sit on the
        // cause instead of the thrown error.
        const code =
          (error as { code?: string })?.code ??
          ((error as { cause?: { code?: string } })?.cause?.code);
        if (code === "23505") {
          throw new AppError("This photo is already registered.", 409);
        }
        throw error;
      }
      if (!row) throw new AppError("Unable to register the store photo.", 502);
      return mapStorePhoto(row);
    },

    async countForStore(storeId: string) {
      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(storePhotos)
        .where(eq(storePhotos.storeId, storeId));
      return Number(result?.count ?? 0);
    },
  };
}
