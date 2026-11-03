import type { AuthUser } from "@repo/api-contracts/auth";
import type { Delivery } from "@repo/api-contracts/deliveries";
import type { Order } from "@repo/api-contracts/orders";
import type { Product, Store } from "@repo/api-contracts/products";
import type {
  CouponClaimStatus,
  CouponProductRef,
  CouponType,
  ImageContentType,
} from "@repo/api-contracts";
import type { AdminUser } from "@repo/api-contracts/users";
import { normalizeRole } from "../roles.js";
import {
  couponClaims,
  couponProducts,
  coupons,
  deliveries,
  orders,
  products,
  storeFollows,
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
/**
 * Application-side coupon. It carries the raw stored columns, including the
 * image object key rather than a URL, because turning a key into a readable
 * URL is a storage concern that may need to sign a request. The response-only
 * fields (`remainingStock`, `imageUrl`, `products`) are assembled by the route
 * layer, exactly as `StorePhotoRecord` is.
 *
 * `validFrom`/`validTo` are already date-only `YYYY-MM-DD` strings because the
 * columns are DATE (S11); no formatting happens here and none is needed.
 */
export type CouponRecord = {
  id: string;
  storeId: string;
  type: CouponType;
  title: string;
  description: string | null;
  freeText: string | null;
  percentageValue: number | null;
  fixedAmountValue: number | null;
  validFrom: string;
  validTo: string;
  totalStock: number;
  claimedCount: number;
  paused: boolean;
  imageObjectKey: string | null;
};

/** A coupon's product reference, with the source it came from (S5). */
export type CouponProductRefRecord = CouponProductRef & { couponId: string };

/**
 * Application-side claim. The stored `qr_token_hash` is deliberately absent:
 * it is a lookup key for the redeem path, never application data, and the
 * plaintext token the customer renders exists only in the response that issues
 * it. `claimedOn`/`redeemedOn` are the date-only display values (S11).
 */
export type CouponClaimRecord = {
  id: string;
  couponId: string;
  customerUserId: string;
  status: CouponClaimStatus;
  claimedOn: string;
  redeemedOn: string | null;
  redeemedByUserId: string | null;
};

export type StoreFollowRecord = {
  customerUserId: string;
  storeId: string;
};

export function mapCoupon(row: typeof coupons.$inferSelect): CouponRecord {
  return {
    id: row.id,
    storeId: row.storeId,
    // No cast: `coupons.type` is typed with the schema's own closed set, so a
    // value added there and not to `CouponType` is a compile error here.
    type: row.type,
    title: row.title,
    description: row.description,
    freeText: row.freeText,
    percentageValue: row.percentageValue,
    fixedAmountValue:
      row.fixedAmountValue === null ? null : Number(row.fixedAmountValue),
    validFrom: row.validFrom,
    validTo: row.validTo,
    totalStock: row.totalStock,
    claimedCount: row.claimedCount,
    paused: row.paused,
    imageObjectKey: row.imageObjectKey,
  };
}

export function mapCouponProduct(
  row: typeof couponProducts.$inferSelect,
): CouponProductRefRecord {
  if (row.storeCatalogProductId !== null) {
    return {
      couponId: row.couponId,
      source: "store_catalog",
      productId: row.storeCatalogProductId,
    };
  }
  if (row.storeProductId !== null) {
    return {
      couponId: row.couponId,
      source: "store_private",
      productId: row.storeProductId,
    };
  }
  // Unreachable while `coupon_products_single_source_chk` exists; it is thrown
  // rather than asserted away so a dropped constraint surfaces loudly.
  throw new Error(
    `Coupon product ${row.id} names no product source. The database CHECK coupon_products_single_source_chk is missing.`,
  );
}

export function mapCouponClaim(
  row: typeof couponClaims.$inferSelect,
): CouponClaimRecord {
  return {
    id: row.id,
    couponId: row.couponId,
    customerUserId: row.customerUserId,
    status: row.status,
    claimedOn: row.claimedOn,
    redeemedOn: row.redeemedOn,
    redeemedByUserId: row.redeemedByUserId,
  };
}

export function mapStoreFollow(
  row: typeof storeFollows.$inferSelect,
): StoreFollowRecord {
  return {
    customerUserId: row.customerUserId,
    storeId: row.storeId,
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
