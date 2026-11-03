import type {
  CatalogStoreProduct,
  Coupon,
  CouponCreateRequest,
  CouponUpdateRequest,
  ImageUploadTicket,
  ImageUploadTicketRequest,
} from "@repo/api-contracts";

import type { AuthenticatedJsonRequest } from "@/src/features/auth/infrastructure/store-photos-fetch-repository";

import { createCouponJsonReader } from "./coupon-json";
import type {
  CouponProductOption,
  CouponStore,
  CouponsRepository,
} from "../application/ports/coupons-repository";

/** The Spanish wording of each action when the API says something new. */
const FALLBACK = {
  stores: "No se pudo cargar tu tienda.",
  coupons: "No se pudieron cargar los cupones.",
  products: "No se pudieron cargar los productos de tu tienda.",
  save: "No se pudo guardar el cupón.",
  pause: "No se pudo pausar el cupón.",
  activate: "No se pudo activar el cupón.",
  image: "No se pudo subir la foto del cupón.",
} as const;

/**
 * A store-private product as `GET /stores/:storeId/products` returns it. It is
 * restated here rather than imported because the products contract has no
 * exported response type carrying the resolved category name.
 */
type StorePrivateProductRow = {
  id: string;
  name: string;
  categoryId?: string | null;
  categoryName?: string | null;
  active?: boolean;
};

export function createCouponsFetchRepository(
  request: AuthenticatedJsonRequest,
): CouponsRepository {
  // One request, one `{ data }` envelope, read by the feature's shared reader
  // so the scanner and the coupon list cannot read the API differently.
  const { readData, sendJson } = createCouponJsonReader(request);

  return {
    listOwnStores: () =>
      readData<CouponStore[]>("/api/v1/tenderos/stores/me", FALLBACK.stores),

    listStoreCoupons: (storeId) =>
      readData<Coupon[]>(
        `/api/v1/tenderos/stores/${storeId}/coupons`,
        FALLBACK.coupons,
      ),

    /**
     * The picker is read SEQUENTIALLY from the two product sources so the first
     * failure is the one reported, and the catalog assignments come first
     * because that is the order the tendero's own catalog screen uses.
     *
     * `category.key` is null on both sources on purpose: neither endpoint
     * carries the catalog category slug today (`CatalogProduct` has
     * `categoryId` and `categoryName` and no slug), so the picker shows the
     * category name and the default icon. The real slug arrives on the coupon
     * itself, where S5's display acceptance needs it.
     */
    async listProductOptions(storeId) {
      const assignments = await readData<CatalogStoreProduct[]>(
        `/api/v1/tenderos/stores/${storeId}/catalog`,
        FALLBACK.products,
      );
      if (!assignments.success) return assignments;

      const privateProducts = await readData<StorePrivateProductRow[]>(
        `/api/v1/tenderos/stores/${storeId}/products`,
        FALLBACK.products,
      );
      if (!privateProducts.success) return privateProducts;

      const options: CouponProductOption[] = [
        ...assignments.data
          .filter((item) => item.active !== false)
          .map((item) => ({
            source: "store_catalog" as const,
            productId: item.id,
            name: item.product?.commercialName ?? "Producto",
            category: item.product?.categoryId
              ? {
                  id: item.product.categoryId,
                  name: item.product.categoryName ?? "Sin categoría",
                  key: null,
                }
              : null,
          })),
        ...privateProducts.data
          .filter((item) => item.active !== false)
          .map((item) => ({
            source: "store_private" as const,
            productId: item.id,
            name: item.name,
            category: item.categoryId
              ? {
                  id: item.categoryId,
                  name: item.categoryName ?? "Sin categoría",
                  key: null,
                }
              : null,
          })),
      ];

      return { success: true, data: options };
    },

    createCoupon: (storeId, payload: CouponCreateRequest) =>
      sendJson<Coupon>(
        `/api/v1/tenderos/stores/${storeId}/coupons`,
        "POST",
        payload,
        FALLBACK.save,
      ),

    updateCoupon: (couponId, payload: CouponUpdateRequest) =>
      sendJson<Coupon>(
        `/api/v1/tenderos/coupons/${couponId}`,
        "PATCH",
        payload,
        FALLBACK.save,
      ),

    /**
     * No body at all, as T4 built these: taking a coupon out of circulation
     * must not require restating its type. Both routes are idempotent and
     * answer with the end state.
     */
    setCouponPaused: (couponId, paused) =>
      readData<Coupon>(
        `/api/v1/tenderos/coupons/${couponId}/${paused ? "pause" : "activate"}`,
        paused ? FALLBACK.pause : FALLBACK.activate,
        { method: "POST" },
      ),

    requestImageTicket: (storeId, ticketRequest: ImageUploadTicketRequest) =>
      sendJson<ImageUploadTicket>(
        `/api/v1/tenderos/stores/${storeId}/coupon-image-uploads`,
        "POST",
        ticketRequest,
        FALLBACK.image,
      ),
  };
}
