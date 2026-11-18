import { and, eq, ne, or, sql } from "drizzle-orm";
import type { DatabaseConnection } from "../connection.js";
import { customerPushDevices } from "../schema.js";

/** A pool connection or a transaction: both expose the statements used here. */
type Executor = Pick<DatabaseConnection, "delete" | "execute" | "insert">;

/**
 * Storage of the device a customer session receives push reminders on.
 *
 * Ownership invariant: an Expo token has one owner and a session family has
 * one token. `bind` enforces both by evicting any other row that holds the
 * token or the family before writing, so a device that switches accounts or
 * rotates its token never stays reachable through the previous owner.
 */
export function createCustomerPushDevicesRepository() {
  /**
   * Serialises writers per token and per family. Both locks are taken in the
   * same order (token, then family) so two callers cannot deadlock.
   */
  async function lock(tx: Executor, expoToken: string, familyId: string) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`push-token:${expoToken}`}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`push-family:${familyId}`}, 0))`,
    );
  }

  async function bind(
    tx: Executor,
    device: { userId: string; familyId: string; expoToken: string },
  ) {
    await lock(tx, device.expoToken, device.familyId);
    await tx
      .delete(customerPushDevices)
      .where(
        or(
          and(
            eq(customerPushDevices.expoToken, device.expoToken),
            ne(customerPushDevices.familyId, device.familyId),
          ),
          and(
            eq(customerPushDevices.familyId, device.familyId),
            ne(customerPushDevices.expoToken, device.expoToken),
          ),
        ),
      );
    await tx
      .insert(customerPushDevices)
      .values(device)
      .onConflictDoUpdate({
        target: customerPushDevices.familyId,
        set: { userId: device.userId, updatedAt: new Date() },
      });
  }

  async function removeForFamily(tx: Executor, familyId: string) {
    await tx
      .delete(customerPushDevices)
      .where(eq(customerPushDevices.familyId, familyId));
  }

  return { bind, removeForFamily };
}
