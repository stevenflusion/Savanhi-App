import type {
  Coupon,
  CouponCreateRequest,
  CouponProductDetail,
  CouponUpdateRequest,
  ImageUploadTicket,
  ImageUploadTicketRequest,
  StorePhoto,
} from "@repo/api-contracts";

/**
 * Every coupon operation answers the same two-case result instead of throwing,
 * following what the auth feature's remote port already does: a screen has to
 * render a failure, not catch one.
 *
 * `error` is always Spanish by the time it leaves the repository (see
 * `coupon-errors.ts`), so no screen ever formats a backend message itself.
 */
export type CouponsResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * The tendero's own store, as the coupon screens need it.
 *
 * `GET /stores/me` already returns all of this in the one response T2 built
 * (the photos arrived with the store-photo upload path); the fields are
 * declared here as OPTIONAL because the coupon workspace only ever needed the
 * name, and the Home header is what reads the rest — a store registered before
 * the photo step existed carries none of them.
 *
 * No id is ever rendered from this (S11): `id` travels in request paths only.
 */
export type CouponStore = {
  id: string;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  photos?: StorePhoto[];
};

/**
 * One row of the product picker. It is exactly the shape a coupon's product
 * reference already has (`CouponProductDetail`), so a selected option becomes a
 * payload reference by dropping its display fields and nothing else.
 */
export type CouponProductOption = CouponProductDetail;

export type CouponsRepository = {
  listOwnStores: () => Promise<CouponsResult<CouponStore[]>>;
  listStoreCoupons: (storeId: string) => Promise<CouponsResult<Coupon[]>>;
  /** Both product models S5 keeps distinguishable, in one list. */
  listProductOptions: (
    storeId: string,
  ) => Promise<CouponsResult<CouponProductOption[]>>;
  createCoupon: (
    storeId: string,
    payload: CouponCreateRequest,
  ) => Promise<CouponsResult<Coupon>>;
  updateCoupon: (
    couponId: string,
    payload: CouponUpdateRequest,
  ) => Promise<CouponsResult<Coupon>>;
  /** Pause and activate are two routes; `paused` picks which one (S6). */
  setCouponPaused: (
    couponId: string,
    paused: boolean,
  ) => Promise<CouponsResult<Coupon>>;
  /**
   * The upload ticket hangs off the STORE, not the coupon: the tendero uploads
   * the photo while still composing the coupon, and the key then travels in the
   * create or update payload (T4).
   */
  requestImageTicket: (
    storeId: string,
    request: ImageUploadTicketRequest,
  ) => Promise<CouponsResult<ImageUploadTicket>>;
};
