import type { AuthRole } from "@repo/api-contracts/auth";
import {
  catalogStoreProductAddSchema,
  catalogStoreProductUpdateSchema,
  storeProductCategoryCreateSchema,
  storeProductCreateSchema,
  storeProductUpdateSchema,
} from "@repo/api-contracts/catalog";
import {
  COUPON_FEED_RADIUS_METERS,
  couponCreateSchema,
  couponImageSetSchema,
  couponRedemptionRequestSchema,
  couponUpdateSchema,
  customerCoordinatesSchema,
  customerFeedQuerySchema,
  customerPushDeviceSchema,
  imageUploadTicketRequestSchema,
  redemptionHistoryQuerySchema,
  storePhotoRegisterSchema,
  STORE_METRICS_RECENT_REDEMPTIONS,
  type Coupon,
  type CouponMetrics,
  type CouponRedemption,
  type CouponRedemptionHistoryPage,
  type CustomerClaim,
  type CustomerCouponFeedItem,
  type CustomerFeedStore,
  type CustomerStore,
  type NearbyStore,
  type StoreMetrics,
  type StoreMetricsTotals,
  type StorePhoto,
} from "@repo/api-contracts";
import {
  AppError,
  createCustomerProfileService,
  customerProfileUpdateSchema,
  isImageKeyOwnedBy,
  type BackendContext,
  type CouponMetricsRecord,
  type CouponProductDetailRecord,
  type CouponRecord,
  type CouponRedemptionRecord,
  type CustomerClaimRecord,
  type GeoPoint,
  type ObjectStorage,
  type StoreDistanceRecord,
  type StorePhotoRecord,
  validateBody,
  validateParams,
} from "@repo/backend-core";
import {
  Router,
  type Request,
  type RequestHandler,
  type Router as ExpressRouter,
} from "express";
import { z } from "zod";

const idParamsSchema = z.object({ id: z.string().uuid() });
const storeIdParamsSchema = z.object({ storeId: z.string().uuid() });
const couponIdParamsSchema = z.object({ couponId: z.string().uuid() });
const claimIdParamsSchema = z.object({ claimId: z.string().uuid() });
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

  /**
   * Redemption (S3, S8). The customer shows the QR, the tendero's scanner reads
   * it, and these two routes are where the scanned token lands.
   *
   * The token travels in the BODY of a POST, never in the path or the query:
   * it is a bearer secret, and a URL ends up in access logs. That is also why
   * the side-effect-free preview is a POST and not a GET.
   *
   * Both are owner scoped inside the repository, against the store that owns
   * the coupon the claim belongs to — a token the tendero does not own answers
   * exactly like a token that matches nothing.
   */
  const toCouponRedemption = async (
    record: CouponRedemptionRecord,
  ): Promise<CouponRedemption> => ({
    claimId: record.claimId,
    status: record.status,
    redeemedOn: record.redeemedOn,
    customerName: record.customerName,
    // The same assembler the coupon routes use, so the confirmation screen
    // shows the title, the type's value and the per-category product icons
    // exactly as the coupon list does (S5, S10).
    coupon: await toCoupon(record.coupon),
    store: record.store,
  });

  /** What this scan WOULD redeem. Reads only; the claim stays claimed. */
  router.post(
    "/api/v1/tenderos/coupon-redemptions/preview",
    requireRole(["tendero"]),
    validateBody(couponRedemptionRequestSchema),
    async (req, res, next) => {
      try {
        const record = await coupons.previewRedemptionByQrToken(
          req.body.qrToken,
          req.auth?.user.id ?? "",
        );
        res.status(200).json({ data: await toCouponRedemption(record) });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Redeems the claim behind the scanned QR. 200 and not 201: the claim already
   * exists — this transitions it — and the response is its end state.
   */
  router.post(
    "/api/v1/tenderos/coupon-redemptions",
    requireRole(["tendero"]),
    validateBody(couponRedemptionRequestSchema),
    async (req, res, next) => {
      try {
        const record = await coupons.redeemByQrToken(
          req.body.qrToken,
          req.auth?.user.id ?? "",
        );
        res.status(200).json({ data: await toCouponRedemption(record) });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Metrics (S9). Read-only, owner scoped, and deliberately TWO routes: one
   * summary the home tab reads in a single request, and one paged history for
   * the screen that scrolls through it.
   *
   * Both hang off the store, because every metric is a fact about one store and
   * the tendero may own several.
   */

  const toCouponMetrics = (record: CouponMetricsRecord): CouponMetrics => ({
    couponId: record.couponId,
    title: record.title,
    type: record.type,
    totalStock: record.totalStock,
    claimedCount: record.claimedCount,
    redeemedCount: record.redeemedCount,
    // Derived from the RESERVATION counter, exactly as the coupon routes do:
    // that counter is what a new claim is checked against, so it is what "what
    // is left" has to mean.
    remainingStock: Math.max(record.totalStock - record.reservedCount, 0),
  });

  /**
   * The store-wide figures, summed from the very array that travels in the same
   * response rather than from a second query — so the big number on the home
   * tab and the rows underneath it cannot tell different stories.
   */
  const toStoreMetricsTotals = (
    entries: CouponMetrics[],
  ): StoreMetricsTotals =>
    entries.reduce<StoreMetricsTotals>(
      (totals, entry) => ({
        couponCount: totals.couponCount + 1,
        claimedCount: totals.claimedCount + entry.claimedCount,
        redeemedCount: totals.redeemedCount + entry.redeemedCount,
        remainingStock: totals.remainingStock + entry.remainingStock,
      }),
      {
        couponCount: 0,
        claimedCount: 0,
        redeemedCount: 0,
        remainingStock: 0,
      },
    );

  /**
   * Everything the home tab shows about one store, in one round trip (S9): the
   * follower count, the per-coupon funnel, the totals and a preview of the
   * newest redemptions. The three reads are independent, so they run together.
   */
  router.get(
    "/api/v1/tenderos/stores/:storeId/metrics",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    async (req, res, next) => {
      try {
        const storeId = await requireOwnedStore(
          req.auth?.user.id ?? "",
          String(req.params.storeId),
        );
        const [followersCount, metrics, recent] = await Promise.all([
          stores.countFollowersByStore(storeId),
          coupons.listMetricsByStoreId(storeId),
          // The SAME reader the history route uses, so the preview can never
          // order or shape its entries differently from the full list.
          coupons.listRedemptionHistoryByStoreId(storeId, {
            limit: STORE_METRICS_RECENT_REDEMPTIONS,
            offset: 0,
          }),
        ]);

        const couponMetrics = metrics.map(toCouponMetrics);
        const data: StoreMetrics = {
          storeId,
          followersCount,
          totals: toStoreMetricsTotals(couponMetrics),
          coupons: couponMetrics,
          recentRedemptions: recent.entries,
        };
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * The paged redemption history (S9). A store's history only grows, so there
   * is no unpaged form of this route at all: the window is validated, bounded
   * and echoed back with the offset of the next page.
   *
   * The query is parsed here rather than through `validateQuery`, for the
   * reason the customer coordinates are (Express 5 defines `req.query` with a
   * getter only, so assigning to it throws). A `ZodError` from here reaches the
   * shared error handler and becomes the same 400 a body rejection does, which
   * is what rejects a limit past the maximum instead of silently clamping it.
   */
  router.get(
    "/api/v1/tenderos/stores/:storeId/redemptions",
    requireRole(["tendero"]),
    validateParams(storeIdParamsSchema),
    async (req, res, next) => {
      try {
        const storeId = await requireOwnedStore(
          req.auth?.user.id ?? "",
          String(req.params.storeId),
        );
        const { limit, offset } = redemptionHistoryQuerySchema.parse(req.query);
        const { entries, hasMore } =
          await coupons.listRedemptionHistoryByStoreId(storeId, {
            limit,
            offset,
          });
        const data: CouponRedemptionHistoryPage = {
          entries,
          limit,
          offset,
          nextOffset: hasMore ? offset + limit : null,
        };
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Customer routes (S2). The customer gets its own app, built later, so there
   * is no screen behind any of these yet — the capability ships as HTTP now,
   * guarded by `requireRole(["client"])`, and the tendero app can never reach
   * it just as a customer can never reach a tendero route.
   *
   * The path segment mirrors `/api/v1/tenderos`: the actor's own name in the
   * product's language, one namespace per app.
   */
  const customerId = (req: { auth?: { user: { id: string } } }) =>
    req.auth?.user.id ?? "";

  /**
   * Eligibility (C9). A customer may use the customer API only with a stored
   * birth date that makes them at least 18 — for a new account and for one that
   * existed before the rule alike. The guard sits AFTER `requireRole`, so an
   * anonymous caller is still a 401 and a tendero still a 403 of the role
   * kind; it reads the birth date from the database on every request, because
   * `registrationStatus` says how far onboarding went and not how old the
   * person is.
   *
   * Every customer route below uses it EXCEPT the profile routes: the way out
   * of the gate cannot be behind the gate, and logout is `/auth/logout`.
   */
  const customerProfile = createCustomerProfileService(
    context.repositories.users,
  );
  const requireClient = requireRole(["client"]);
  const requireEligibleClient: RequestHandler = (req, res, next) => {
    requireClient(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      customerProfile.requireEligible(customerId(req)).then(() => next(), next);
    });
  };

  router.get(
    "/api/v1/clientes/profile",
    requireRole(["client"]),
    async (req, res, next) => {
      try {
        res.status(200).json({ data: await customerProfile.get(customerId(req)) });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * The customer's registration data in one write (C8): name and birth date, a
   * PUT because both are always sent. It is additive on purpose — the shared
   * `PATCH /auth/me` is the tendero's route too and is not touched. An
   * underage date answers 422 and changes nothing.
   */
  router.put(
    "/api/v1/clientes/profile",
    requireRole(["client"]),
    validateBody(customerProfileUpdateSchema),
    async (req, res, next) => {
      try {
        res
          .status(200)
          .json({ data: await customerProfile.update(customerId(req), req.body) });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * The device this customer session receives coupon-expiry reminders on.
   *
   * The owner is the authenticated session and never the body. PUT is behind
   * the eligibility gate; DELETE only needs an authenticated customer, so a
   * person who stopped being eligible can still switch reminders off. Both are
   * idempotent 204s, and the registration follows the session's refresh-token
   * family (see `customer_push_devices`).
   */
  router.put(
    "/api/v1/clientes/push-device",
    requireEligibleClient,
    validateBody(customerPushDeviceSchema),
    async (req, res, next) => {
      try {
        await context.authService.registerPushDevice(
          req.auth?.token ?? "",
          req.body.expoToken,
        );
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/api/v1/clientes/push-device",
    requireClient,
    async (req, res, next) => {
      try {
        await context.authService.removePushDevice(req.auth?.token ?? "");
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * The customer's position, validated out of the query string.
   *
   * Parsed here rather than through `validateQuery`, which assigns
   * `req.query`: Express 5 defines that property with a getter only, so the
   * assignment throws. A `ZodError` from here reaches the shared error handler
   * and becomes the same 400 a body rejection does.
   */
  const customerPoint = (req: Request): GeoPoint => {
    const { lat, lng } = customerCoordinatesSchema.parse(req.query);
    return { latitude: lat, longitude: lng };
  };

  /**
   * The feed's position, which the customer may not have (C3): a denied
   * location permission means no coordinates at all, and the decision was to
   * answer the followed stores instead of an empty screen.
   *
   * `undefined` is "no position". Half a position is rejected by the schema,
   * because the missing axis has no honest value to stand in for it.
   */
  const customerFeedPoint = (req: Request): GeoPoint | undefined => {
    const { lat, lng } = customerFeedQuerySchema.parse(req.query);
    if (lat === undefined || lng === undefined) return undefined;
    return { latitude: lat, longitude: lng };
  };

  /**
   * Metres are the measure the database returns; a card renders kilometres.
   * Both travel, so neither client re-derives the other (S11 bans ids and
   * times in what a screen shows, not units).
   */
  const toFeedStore = (record: StoreDistanceRecord): CustomerFeedStore => ({
    id: record.id,
    name: record.name,
    address: record.address,
    latitude: record.latitude,
    longitude: record.longitude,
    distanceMeters:
      record.distanceMeters === null ? null : Math.round(record.distanceMeters),
    distanceKm:
      record.distanceMeters === null
        ? null
        : Math.round(record.distanceMeters / 10) / 100,
  });

  /** Inside the radius, so both the coordinates and the distance are known. */
  const toNearbyStore = (record: StoreDistanceRecord): NearbyStore => {
    const store = toFeedStore(record);
    if (
      store.latitude === null ||
      store.longitude === null ||
      store.distanceMeters === null ||
      store.distanceKm === null
    ) {
      throw new AppError("Unable to measure the distance to a store.", 502);
    }
    return {
      ...store,
      latitude: store.latitude,
      longitude: store.longitude,
      distanceMeters: store.distanceMeters,
      distanceKm: store.distanceKm,
    };
  };

  const toCustomerStore = (record: StoreDistanceRecord): CustomerStore => ({
    id: record.id,
    name: record.name,
    address: record.address,
    latitude: record.latitude,
    longitude: record.longitude,
  });

  /**
   * Assembles claims with their coupons in one pass through the coupon
   * assembler above, so a wallet of N claims costs the same queries as one.
   *
   * `expired` is DERIVED here and never stored: after the validity end date an
   * unredeemed claim is expired (S6), and the repository computed that against
   * the coupon calendar day in the same query that read the claim.
   *
   * `qrToken` is non-null only on the two paths that issue one. Everywhere
   * else it is null, because only the hash was kept (S3).
   */
  const toCustomerClaims = async (
    records: CustomerClaimRecord[],
    qrToken: string | null = null,
  ): Promise<CustomerClaim[]> => {
    const assembled = await toCoupons(records.map((record) => record.coupon));
    return records.map((record, index) => {
      const coupon = assembled[index];
      if (!coupon) throw new AppError("Unable to read the claim.", 502);
      return {
        id: record.id,
        // Two derived statuses over one stored one. `released` comes first
        // because it is why the claim ended (C4): a claim the customer gave
        // back is released even once its coupon's window has passed.
        status:
          record.status === "redeemed"
            ? "redeemed"
            : record.released
              ? "released"
              : record.expired
                ? "expired"
                : "claimed",
        qrToken,
        claimedOn: record.claimedOn,
        redeemedOn: record.redeemedOn,
        coupon,
        store: record.store,
      };
    });
  };

  const toCustomerClaim = async (
    records: CustomerClaimRecord[],
    qrToken: string | null = null,
  ): Promise<CustomerClaim> => {
    const [claim] = await toCustomerClaims(records, qrToken);
    if (!claim) throw new AppError("Unable to read the claim.", 502);
    return claim;
  };

  router.get(
    "/api/v1/clientes/stores/nearby",
    requireEligibleClient,
    async (req, res, next) => {
      try {
        const records = await stores.listNearbyActive(
          customerPoint(req),
          COUPON_FEED_RADIUS_METERS,
        );
        res.status(200).json({ data: records.map(toNearbyStore) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/api/v1/clientes/stores/followed",
    requireEligibleClient,
    async (req, res, next) => {
      try {
        const records = await stores.listFollowedByCustomer(customerId(req));
        res.status(200).json({ data: records.map(toCustomerStore) });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Follow and unfollow are idempotent, so they are a PUT and a DELETE on the
   * same sub-resource and both answer with the end state rather than with what
   * changed (S7).
   */
  router.put(
    "/api/v1/clientes/stores/:storeId/follow",
    requireEligibleClient,
    validateParams(storeIdParamsSchema),
    async (req, res, next) => {
      try {
        const data = await stores.followForCustomer(
          customerId(req),
          String(req.params.storeId),
        );
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/api/v1/clientes/stores/:storeId/follow",
    requireEligibleClient,
    validateParams(storeIdParamsSchema),
    async (req, res, next) => {
      try {
        const data = await stores.unfollowForCustomer(
          customerId(req),
          String(req.params.storeId),
        );
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * The SINGLE feed (S7). One response holds the claimable coupons of every
   * store within 3 km PLUS every followed store's, however far away, each
   * carrying the `followed` flag the “Siguiendo” badge needs and whether this
   * customer already claimed it. There is deliberately no second, followed-only
   * feed endpoint.
   *
   * A store reached both ways appears once: the store set is a map keyed by id,
   * and the nearby record wins because it is the one that carries a measured
   * distance.
   *
   * Ordering is by distance ascending, with the stores that were never pinned
   * on the map last. The sort is stable, so coupons of equally distant stores
   * keep the repository's newest-first order.
   */
  router.get(
    "/api/v1/clientes/coupons/feed",
    requireEligibleClient,
    async (req, res, next) => {
      try {
        const customer = customerId(req);
        const point = customerFeedPoint(req);
        // With no position there is no "within 3 km" half to read: nothing is
        // measurable from nowhere, so the one feed is its followed half (C3)
        // and every item carries `distanceMeters: null`.
        const [nearby, followed] = await Promise.all([
          point === undefined
            ? []
            : stores.listNearbyActive(point, COUPON_FEED_RADIUS_METERS),
          stores.listFollowedByCustomer(customer, point),
        ]);

        const followedIds = new Set(followed.map((store) => store.id));
        const storesById = new Map<string, StoreDistanceRecord>();
        for (const record of [...nearby, ...followed]) {
          if (!storesById.has(record.id)) storesById.set(record.id, record);
        }

        const records = await coupons.listClaimableForCustomer(
          [...storesById.keys()],
          customer,
        );
        const assembled = await toCoupons(records);
        const data: CustomerCouponFeedItem[] = records.map(
          (record, index) => {
            const coupon = assembled[index];
            const store = storesById.get(record.storeId);
            if (!coupon || !store) {
              throw new AppError("Unable to read the coupon feed.", 502);
            }
            return {
              coupon,
              store: toFeedStore(store),
              followed: followedIds.has(record.storeId),
              claimed: record.claimed,
            };
          },
        );

        // `MAX_VALUE` rather than `Infinity`: subtracting two infinities is
        // `NaN`, which would make the comparator inconsistent.
        const rank = (item: CustomerCouponFeedItem) =>
          item.store.distanceMeters ?? Number.MAX_VALUE;
        data.sort((left, right) => rank(left) - rank(right));

        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Claiming reserves stock; redemption happens later in the store (S8), so
   * this creates a claim and answers 201 with the plaintext QR token. That
   * token is in this response and nowhere else — the database holds only its
   * hash (S3) — and a customer who loses it re-issues it below.
   */
  router.post(
    "/api/v1/clientes/coupons/:couponId/claims",
    requireEligibleClient,
    validateParams(couponIdParamsSchema),
    async (req, res, next) => {
      try {
        const customer = customerId(req);
        const { claimId, qrToken } = await coupons.claimForCustomer(
          String(req.params.couponId),
          customer,
        );
        const records = await coupons.listClaimDetailsForCustomer(
          customer,
          claimId,
        );
        res
          .status(201)
          .json({ data: await toCustomerClaim(records, qrToken) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/api/v1/clientes/claims",
    requireEligibleClient,
    async (req, res, next) => {
      try {
        const records = await coupons.listClaimDetailsForCustomer(
          customerId(req),
        );
        res.status(200).json({ data: await toCustomerClaims(records) });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Releases one of the customer's own claims (C4): the reserved unit goes
   * back to the coupon's stock and the QR stops working.
   *
   * It is a POST on a sub-resource and not a `DELETE /claims/:id`, because
   * nothing is deleted: the claim row stays as data, which is what keeps once
   * per customer true (S6) and what the wallet renders as `released`. The
   * answer is 200 and not 201, the same reading the redemption uses — the
   * claim already existed and this call transitions it.
   */
  router.post(
    "/api/v1/clientes/claims/:claimId/release",
    requireEligibleClient,
    validateParams(claimIdParamsSchema),
    async (req, res, next) => {
      try {
        const customer = customerId(req);
        const { claimId } = await coupons.releaseClaimForCustomer(
          String(req.params.claimId),
          customer,
        );
        const records = await coupons.listClaimDetailsForCustomer(
          customer,
          claimId,
        );
        res.status(200).json({ data: await toCustomerClaim(records) });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Re-issues the QR of one of the customer's own claims. It exists because
   * only the hash is stored: the plaintext cannot be read back, so recovery is
   * a new token, and writing it over the hash is what kills the old one.
   */
  router.post(
    "/api/v1/clientes/claims/:claimId/qr",
    requireEligibleClient,
    validateParams(claimIdParamsSchema),
    async (req, res, next) => {
      try {
        const customer = customerId(req);
        const { claimId, qrToken } =
          await coupons.rotateClaimQrTokenForCustomer(
            String(req.params.claimId),
            customer,
          );
        const records = await coupons.listClaimDetailsForCustomer(
          customer,
          claimId,
        );
        res
          .status(200)
          .json({ data: await toCustomerClaim(records, qrToken) });
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
