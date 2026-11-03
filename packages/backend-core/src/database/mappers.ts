import type { AuthUser } from "@repo/api-contracts/auth";
import type { Delivery } from "@repo/api-contracts/deliveries";
import type { Order } from "@repo/api-contracts/orders";
import type { Product, Store } from "@repo/api-contracts/products";
import type { ImageContentType } from "@repo/api-contracts";
import type { AdminUser } from "@repo/api-contracts/users";
import { normalizeRole } from "../roles.js";
import {
  deliveries,
  orders,
  products,
  storePhotos,
  stores,
  users,
} from "./schema.js";

/**
 * Application-side store photo. It carries the object key instead of a URL,
 * because turning a key into a readable URL is a storage concern and may need
 * to sign a request.
 */
export type StorePhotoRecord = {
  id: string;
  storeId: string;
  objectKey: string;
  contentType: ImageContentType;
  byteSize: number;
  position: number;
};

type UserRow = typeof users.$inferSelect & { roleName: string };

export function mapProfile(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: normalizeRole(row.roleName, "tendero"),
    active: row.active,
    emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
    registrationStatus: row.registrationStatus,
  };
}
export function mapAdminUser(row: UserRow): AdminUser {
  return {
    ...mapProfile(row),
    createdAt: row.createdAt?.toISOString() ?? null,
  };
}
export function mapStore(row: typeof stores.$inferSelect): Store {
  return {
    id: row.id,
    ownerProfileId: row.ownerUserId,
    name: row.name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    paymentMethod: row.paymentMethod as Store["paymentMethod"],
    bankAccountName: row.bankAccountName,
    bankAccountNumber: row.bankAccountNumber,
    bankAccountType: row.bankAccountType as Store["bankAccountType"],
    active: row.active,
    createdAt: row.createdAt?.toISOString() ?? null,
  };
}
export function mapStorePhoto(
  row: typeof storePhotos.$inferSelect,
): StorePhotoRecord {
  return {
    id: row.id,
    storeId: row.storeId,
    objectKey: row.objectKey,
    contentType: row.contentType as ImageContentType,
    byteSize: row.byteSize,
    position: row.position,
  };
}
export function mapProduct(row: typeof products.$inferSelect): Product {
  return {
    id: row.id,
    storeId: row.storeId,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    stock: row.stock,
    active: row.active,
    createdAt: row.createdAt?.toISOString() ?? null,
  };
}
export function mapOrder(row: typeof orders.$inferSelect): Order {
  return {
    id: row.id,
    clientProfileId: row.clientUserId,
    storeId: row.storeId,
    status: row.status as Order["status"],
    total: Number(row.total),
    createdAt: row.createdAt?.toISOString() ?? null,
  };
}
export function mapDelivery(row: typeof deliveries.$inferSelect): Delivery {
  return {
    id: row.id,
    orderId: row.orderId,
    deliveryProfileId: row.deliveryUserId,
    status: row.status as Delivery["status"],
    createdAt: row.createdAt?.toISOString() ?? null,
  };
}
