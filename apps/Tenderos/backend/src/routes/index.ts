import type { AuthRole } from "@repo/api-contracts/auth";
import {
  catalogStoreProductAddSchema,
  catalogStoreProductUpdateSchema,
  storeProductCategoryCreateSchema,
  storeProductCreateSchema,
  storeProductUpdateSchema,
} from "@repo/api-contracts/catalog";
import {
  imageUploadTicketRequestSchema,
  storePhotoRegisterSchema,
  type StorePhoto,
} from "@repo/api-contracts";
import {
  AppError,
  isImageKeyOwnedBy,
  type BackendContext,
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

  // Orders are frozen for the cuponera MVP: no order route is mounted, so
  // every order path answers 404. `orders.repository.ts` and the order
  // contracts stay in place for when the capability is resumed.

  return router;
}
