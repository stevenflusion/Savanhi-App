import type { AuthRole } from "@repo/api-contracts/auth";
import {
  catalogStoreProductAddSchema,
  catalogStoreProductUpdateSchema,
} from "@repo/api-contracts/catalog";
import { ORDER_STATUSES } from "@repo/api-contracts/orders";
import {
  AppError,
  type BackendContext,
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
const productSchema = z.object({
  storeId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  price: z.number().nonnegative(),
  stock: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
});
const orderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

type RequireRole = (roles: AuthRole[]) => RequestHandler;

export function createApiRouter({
  context,
  requireRole,
}: {
  context: BackendContext;
  requireRole: RequireRole;
}): ExpressRouter {
  const router = Router();
  const { catalog, orders, products, stores } = context.repositories;

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
        const data = await stores.listByOwner(req.auth?.user.id ?? "");
        res.status(200).json({ data });
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
    validateBody(productSchema.partial()),
    async (req, res, next) => {
      try {
        const storeIds = await stores.listIdsByOwner(req.auth?.user.id ?? "");
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

  router.get(
    "/api/v1/tenderos/orders",
    requireRole(["tendero"]),
    async (req, res, next) => {
      try {
        const storeIds = await stores.listIdsByOwner(req.auth?.user.id ?? "");
        const data = await orders.listByStoreIds(storeIds);
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/api/v1/tenderos/orders/:id/status",
    requireRole(["tendero"]),
    validateParams(idParamsSchema),
    validateBody(orderStatusSchema),
    async (req, res, next) => {
      try {
        const storeIds = await stores.listIdsByOwner(req.auth?.user.id ?? "");
        const data = await orders.updateStatusForStores(
          String(req.params.id),
          storeIds,
          req.body.status,
        );
        res.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
