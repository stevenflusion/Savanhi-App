import type { AuthRole } from "@repo/api-contracts/auth";
import {
  catalogStoreProductAddSchema,
  catalogStoreProductUpdateSchema,
  storeProductCategoryCreateSchema,
  storeProductCreateSchema,
  storeProductUpdateSchema,
} from "@repo/api-contracts/catalog";
import {
  couponCreateSchema,
  couponImageSetSchema,
  couponUpdateSchema,
  imageUploadTicketRequestSchema,
  storePhotoRegisterSchema,
  type Coupon,
  type StorePhoto,
} from "@repo/api-contracts";
import {
  AppError,
  isImageKeyOwnedBy,
  type BackendContext,
  type CouponProductDetailRecord,
  type CouponRecord,
  type ObjectStorage,
  type StorePhotoRecord,
  validateBody,
  validateParams,
} from "@repo/backend-core";
import {
  Router,
  type RequestHandler,
  type Router as ExpressRouter,
} from "express";
import { z } from "zod";

const idParamsSchema = z.object({ id: z.string().uuid() });
const storeIdParamsSchema = z.object({ storeId: z.string().uuid() });
const couponIdParamsSchema = z.object({ couponId: z.string().uuid() });
const storeSchema = z.object({
  name: z.string().min(1),
  address: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  paymentMethod: z.enum(["efectivo", "pichincha"]).nullable().optional(),
});
const productSchema = storeProductCreateSchema.extend({
  storeId: z.string().uuid().nullable().optional(),
});
const productUpdateSchema = storeProductUpdateSchema.extend({
  storeId: z.string().uuid().nullable().optional(),
});

type RequireRole = (roles: AuthRole[]) => RequestHandler;

export function createApiRouter({
  context,
  requireRole,
  storage,
}: {
  context: BackendContext;
  requireRole: RequireRole;
  storage: ObjectStorage;
}): ExpressRouter {
  const router = Router();
  const {
    catalog,
    coupons,
    products,
    storePhotos,
    stores,
  } = context.repositories;

  /** Rejects a store the authenticated tendero does not own. */
  const requireOwnedStore = async (
    ownerProfileId: string,
    storeId: string,
  ) => {
    if (!(await stores.listIdsByOwner(ownerProfileId)).includes(storeId)) {
      throw new AppError("Store does not belong to this tendero.", 403);
    }
    return storeId;
  };

  const toStorePhoto = async (
    record: StorePhotoRecord,
  ): Promise<StorePhoto> => ({
    id: record.id,
    url: await storage.buildReadUrl(record.objectKey),
    contentType: record.contentType,
    position: record.position,
  });

  /**
   * Assembles the response shape of several coupons in two queries instead of
   * one per coupon. `remainingStock` and `imageUrl` are derived here, exactly
   * as `toStorePhoto` derives a photo URL: the repository returns stored
   * columns, the route turns them into what a screen needs.
   */
  const toCoupons = async (records: CouponRecord[]): Promise<Coupon[]> => {
    const details = await coupons.listProductDetailsByCouponIds(
      records.map((record) => record.id),
    );
    const detailsByCoupon = new Map<string, CouponProductDetailRecord[]>();
    for (const detail of details) {
      const group = detailsByCoupon.get(detail.couponId) ?? [];
      group.push(detail);
      detailsByCoupon.set(detail.couponId, group);
    }

    return Promise.all(
      records.map(async (record) => ({
        id: record.id,
        storeId: record.storeId,
        type: record.type,
        title: record.title,
        description: record.description,
        freeText: record.freeText,
        percentageValue: record.percentageValue,
        fixedAmountValue: record.fixedAmountValue,
        // Already date-only `YYYY-MM-DD`, because the columns are DATE (S11).
        validFrom: record.validFrom,
        validTo: record.validTo,
        totalStock: record.totalStock,
        claimedCount: record.claimedCount,
        remainingStock: Math.max(record.totalStock - record.claimedCount, 0),
        paused: record.paused,
        imageUrl:
          record.imageObjectKey === null
            ? null
            : await storage.buildReadUrl(record.imageObjectKey),
        // The reference drops only its grouping key: `name` and `category`
        // are already what the screen renders (S10 — the app maps a
        // per-category icon, there are no product images).
        products: (detailsByCoupon.get(record.id) ?? []).map(
          ({ couponId: _couponId, ...detail }) => detail,
        ),
      })),
    );
  };

  const toCoupon = async (record: CouponRecord): Promise<Coupon> => {
    const [coupon] = await toCoupons([record]);
    if (!coupon) throw new AppError("Unable to read the coupon.", 502);
    return coupon;
  };

  /** The stores this tendero owns; the scope of every coupon-id route. */
  const ownedStoreIds = (req: { auth?: { user: { id: string } } }) =>
    stores.listIdsByOwner(req.auth?.user.id ?? "");

  /**
   * Every path that stores a coupon image key goes through here — create,
   * update and `PUT .../image` all accept the field, so the check cannot live
   * in only one of them.
   */
  const requireOwnedCouponImageKey = (
    objectKey: string,
    storeId: string,
  ) => {
    if (!isImageKeyOwnedBy(objectKey, { scope: "coupons", ownerId: storeId })) {
      throw new AppError(
        "This image reference does not belong to this store.",
        403,
      );
    }
  };

  router.get("/api/v1/tenderos/status", (_req, res) => {
    res.status(200).json({
      section: "Tenderos",
      backend: "tenderos-backend",
      status: "ready",
    });
  });

  router.get(
    "/api/v1/tenderos/stores/me",
    requireRole(["tendero"]),
    async (req, res, next) => {
      try {
        const owned = await stores.listByOwner(req.auth?.user.id ?? "");
        const records = await storePhotos.listByStoreIds(
          owned.map((store) => store.id),
        );
        const photosByStore = new Map<string, StorePhoto[]>();
        for (const record of records) {
          const photos = photosByStore.get(record.storeId) ?? [];
          photos.push(await toStorePhoto(record));
          photosByStore.set(record.storeId, photos);
        }
        const data = owned.map((store) => ({
          ...store,
          photos: photosByStore.get(store.id) ?? [],
        }));
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Issues a presigned PUT so the image bytes bypass `express.json`'s 100kb
   * limit. The object key is generated here; a client never names its own.
   */
  router.post(
    "/api/v1/tenderos/stores/:storeId/photo-uploads",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    validateBody(imageUploadTicketRequestSchema),
    async (req, res, next) => {
      try {
        const storeId = await requireOwnedStore(
          req.auth?.user.id ?? "",
          String(req.params.storeId),
        );
        const data = await storage.createImageUploadTicket({
          owner: { scope: "stores", ownerId: storeId },
          contentType: req.body.contentType,
          contentLength: req.body.contentLength,
        });
        res.status(201).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/api/v1/tenderos/stores/:storeId/photos",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    validateBody(storePhotoRegisterSchema),
    async (req, res, next) => {
      try {
        const storeId = await requireOwnedStore(
          req.auth?.user.id ?? "",
          String(req.params.storeId),
        );
        if (
          !isImageKeyOwnedBy(req.body.objectKey, {
            scope: "stores",
            ownerId: storeId,
          })
        ) {
          throw new AppError(
            "This image reference does not belong to this store.",
            403,
          );
        }
        const record = await storePhotos.createForStore(storeId, req.body);
        res.status(201).json({ data: await toStorePhoto(record) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/api/v1/tenderos/stores",
    requireRole(["tendero"]),
    validateBody(storeSchema),
    async (req, res, next) => {
      try {
        const data = await stores.createForOwner(
          req.auth?.user.id ?? "",
          req.body,
        );
        res.status(201).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/api/v1/tenderos/stores/:storeId/product-categories",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    async (req, res, next) => {
      try {
        const storeId = String(req.params.storeId);
        if (
          !(await stores.listIdsByOwner(req.auth?.user.id ?? "")).includes(
            storeId,
          )
        )
          throw new AppError("Store does not belong to this tendero.", 403);
        res
          .status(200)
          .json({ data: await catalog.listCategoriesForStore(storeId) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/api/v1/tenderos/stores/:storeId/product-categories",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    validateBody(storeProductCategoryCreateSchema),
    async (req, res, next) => {
      try {
        const storeId = String(req.params.storeId);
        if (
          !(await stores.listIdsByOwner(req.auth?.user.id ?? "")).includes(
            storeId,
          )
        )
          throw new AppError("Store does not belong to this tendero.", 403);
        res
          .status(201)
          .json({
            data: await catalog.createCategoryForStore(storeId, req.body),
          });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/api/v1/tenderos/catalog",
    requireRole(["tendero"]),
    async (_req, res, next) => {
      try {
        const data = await catalog.listGlobalActive();
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/api/v1/tenderos/stores/:storeId/catalog",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    async (req, res, next) => {
      try {
        const storeIds = await stores.listIdsByOwner(req.auth?.user.id ?? "");
        if (!storeIds.includes(String(req.params.storeId))) {
          throw new AppError("Store does not belong to this tendero.", 403);
        }
        const data = await catalog.listByStoreIds([String(req.params.storeId)]);
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/api/v1/tenderos/stores/:storeId/catalog",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    validateBody(catalogStoreProductAddSchema),
    async (req, res, next) => {
      try {
        const storeIds = await stores.listIdsByOwner(req.auth?.user.id ?? "");
        const storeId = String(req.params.storeId);
        if (!storeIds.includes(storeId)) {
          throw new AppError("Store does not belong to this tendero.", 403);
        }
        const data = await catalog.addToStore(storeId, req.body);
        res.status(201).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/api/v1/tenderos/store-catalog-products/:id",
    requireRole(["tendero"]),
    validateParams(idParamsSchema),
    validateBody(catalogStoreProductUpdateSchema),
    async (req, res, next) => {
      try {
        const storeIds = await stores.listIdsByOwner(req.auth?.user.id ?? "");
        const data = await catalog.updateForStores(
          String(req.params.id),
          storeIds,
          req.body,
        );
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/api/v1/tenderos/store-catalog-products/:id",
    requireRole(["tendero"]),
    validateParams(idParamsSchema),
    async (req, res, next) => {
      try {
        const storeIds = await stores.listIdsByOwner(req.auth?.user.id ?? "");
        const data = await catalog.deactivateForStores(
          String(req.params.id),
          storeIds,
        );
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/api/v1/tenderos/stores/:storeId/products",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    async (req, res, next) => {
      try {
        const storeId = String(req.params.storeId);
        if (
          !(await stores.listIdsByOwner(req.auth?.user.id ?? "")).includes(
            storeId,
          )
        )
          throw new AppError("Store does not belong to this tendero.", 403);
        res
          .status(200)
          .json({ data: await products.listByStoreIds([storeId]) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/api/v1/tenderos/stores/:storeId/products",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    validateBody(productSchema),
    async (req, res, next) => {
      try {
        const storeId = String(req.params.storeId);
        if (
          !(await stores.listIdsByOwner(req.auth?.user.id ?? "")).includes(
            storeId,
          )
        )
          throw new AppError("Store does not belong to this tendero.", 403);
        res
          .status(201)
          .json({ data: await products.createForStore(storeId, req.body) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/api/v1/tenderos/products",
    requireRole(["tendero"]),
    async (req, res, next) => {
      try {
        const storeIds = await stores.listIdsByOwner(req.auth?.user.id ?? "");
        const data = await products.listByStoreIds(storeIds);
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/api/v1/tenderos/products",
    requireRole(["tendero"]),
    validateBody(productSchema),
    async (req, res, next) => {
      try {
        const storeIds = await stores.listIdsByOwner(req.auth?.user.id ?? "");
        const storeId = req.body.storeId ?? storeIds[0];
        if (!storeId || !storeIds.includes(storeId))
          throw new AppError("Store does not belong to this tendero.", 403);

        const data = await products.createForStore(storeId, req.body);
        res.status(201).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/api/v1/tenderos/products/:id",
    requireRole(["tendero"]),
    validateParams(idParamsSchema),
    validateBody(productUpdateSchema),
    async (req, res, next) => {
      try {
        const storeIds = await stores.listIdsByOwner(req.auth?.user.id ?? "");
        if (
          req.body.storeId !== undefined &&
          (!req.body.storeId || !storeIds.includes(req.body.storeId))
        )
          throw new AppError("Store does not belong to this tendero.", 403);
        const data = await products.updateForStores(
          String(req.params.id),
          storeIds,
          req.body,
        );
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/api/v1/tenderos/products/:id",
    requireRole(["tendero"]),
    validateParams(idParamsSchema),
    async (req, res, next) => {
      try {
        const storeIds = await stores.listIdsByOwner(req.auth?.user.id ?? "");
        const data = await products.deactivateForStores(
          String(req.params.id),
          storeIds,
        );
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Coupons. The store-scoped routes live under the store that owns them; the
   * ones that act on a single coupon take the coupon id, because the tendero
   * reaches a coupon from a list and the store is implied by ownership.
   *
   * There is deliberately NO delete route. A coupon carries real customer
   * claims (`coupon_claims`) and holds RESTRICT references to the products it
   * applies to, so deleting one would destroy a customer's claim; pausing is
   * the reversible way to take a coupon out of circulation (S6), and the MVP
   * schema has no archived state to move it to.
   */

  /**
   * An upload ticket for a coupon image. It hangs off the store, not the
   * coupon, because the tendero uploads the image while still composing the
   * coupon — the key then travels in the create payload, or later through
   * `PUT /coupons/:couponId/image`.
   */
  router.post(
    "/api/v1/tenderos/stores/:storeId/coupon-image-uploads",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    validateBody(imageUploadTicketRequestSchema),
    async (req, res, next) => {
      try {
        const storeId = await requireOwnedStore(
          req.auth?.user.id ?? "",
          String(req.params.storeId),
        );
        const data = await storage.createImageUploadTicket({
          owner: { scope: "coupons", ownerId: storeId },
          contentType: req.body.contentType,
          contentLength: req.body.contentLength,
        });
        res.status(201).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/api/v1/tenderos/stores/:storeId/coupons",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    validateBody(couponCreateSchema),
    async (req, res, next) => {
      try {
        const storeId = await requireOwnedStore(
          req.auth?.user.id ?? "",
          String(req.params.storeId),
        );
        if (req.body.imageObjectKey) {
          requireOwnedCouponImageKey(req.body.imageObjectKey, storeId);
        }
        const record = await coupons.createForStore(storeId, req.body);
        res.status(201).json({ data: await toCoupon(record) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/api/v1/tenderos/stores/:storeId/coupons",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    async (req, res, next) => {
      try {
        const storeId = await requireOwnedStore(
          req.auth?.user.id ?? "",
          String(req.params.storeId),
        );
        const records = await coupons.listByStoreIds([storeId]);
        res.status(200).json({ data: await toCoupons(records) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/api/v1/tenderos/coupons/:couponId",
    requireRole(["tendero"]),
    validateParams(couponIdParamsSchema),
    async (req, res, next) => {
      try {
        const record = await coupons.findForStores(
          String(req.params.couponId),
          await ownedStoreIds(req),
        );
        res.status(200).json({ data: await toCoupon(record) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/api/v1/tenderos/coupons/:couponId",
    requireRole(["tendero"]),
    validateParams(couponIdParamsSchema),
    validateBody(couponUpdateSchema),
    async (req, res, next) => {
      try {
        const couponId = String(req.params.couponId);
        const storeIds = await ownedStoreIds(req);
        if (req.body.imageObjectKey) {
          const current = await coupons.findForStores(couponId, storeIds);
          requireOwnedCouponImageKey(
            req.body.imageObjectKey,
            current.storeId,
          );
        }
        const record = await coupons.updateForStores(
          couponId,
          storeIds,
          req.body,
        );
        res.status(200).json({ data: await toCoupon(record) });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Pause and activate are their own routes rather than a `paused` field on
   * the update: the update payload has to restate the coupon's `type` so the
   * contract knows which product cardinality applies, and taking a coupon out
   * of circulation should not require sending its type back. Both are
   * idempotent and answer with the end state.
   */
  router.post(
    "/api/v1/tenderos/coupons/:couponId/pause",
    requireRole(["tendero"]),
    validateParams(couponIdParamsSchema),
    async (req, res, next) => {
      try {
        const record = await coupons.setPausedForStores(
          String(req.params.couponId),
          await ownedStoreIds(req),
          true,
        );
        res.status(200).json({ data: await toCoupon(record) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/api/v1/tenderos/coupons/:couponId/activate",
    requireRole(["tendero"]),
    validateParams(couponIdParamsSchema),
    async (req, res, next) => {
      try {
        const record = await coupons.setPausedForStores(
          String(req.params.couponId),
          await ownedStoreIds(req),
          false,
        );
        res.status(200).json({ data: await toCoupon(record) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    "/api/v1/tenderos/coupons/:couponId/image",
    requireRole(["tendero"]),
    validateParams(couponIdParamsSchema),
    validateBody(couponImageSetSchema),
    async (req, res, next) => {
      try {
        const couponId = String(req.params.couponId);
        const storeIds = await ownedStoreIds(req);
        const current = await coupons.findForStores(couponId, storeIds);
        requireOwnedCouponImageKey(req.body.objectKey, current.storeId);
        const record = await coupons.setImageForStores(
          couponId,
          storeIds,
          req.body.objectKey,
        );
        res.status(200).json({ data: await toCoupon(record) });
      } catch (error) {
        next(error);
      }
    },
  );

  // Orders are frozen for the cuponera MVP: no order route is mounted, so
  // every order path answers 404. `orders.repository.ts` and the order
  // contracts stay in place for when the capability is resumed.

  return router;
}
