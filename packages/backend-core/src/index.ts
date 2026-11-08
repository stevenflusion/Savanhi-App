export { createBackendApp } from "./app.js";
export { createAuthRouter, createRequireAuth, createRequireRole } from "./auth/router.js";
export { createAuthService } from "./auth/service.js";
export { customerProfileUpdateSchema } from "./auth/schemas.js";
export {
  createCustomerProfileService,
  evaluateCustomerEligibility,
} from "./auth/customer-profile.js";
export type { AuthService } from "./auth/service.js";
export { createBackendContext } from "./context/backend-context.js";
export type { BackendContext, BackendRepositories } from "./context/backend-context.js";
export { createDatabaseConnection } from "./database/connection.js";
export type { DatabaseConnection } from "./database/connection.js";
export { createAuthLogsRepository } from "./database/repositories/auth-logs.repository.js";
export { createCatalogRepository } from "./database/repositories/catalog.repository.js";
export { createCouponsRepository } from "./database/repositories/coupons.repository.js";
export { createDeliveriesRepository } from "./database/repositories/deliveries.repository.js";
export { createOrdersRepository } from "./database/repositories/orders.repository.js";
export { createProductsRepository } from "./database/repositories/products.repository.js";
export { createStorePhotosRepository } from "./database/repositories/store-photos.repository.js";
export { createStoresRepository } from "./database/repositories/stores.repository.js";
export { createUsersRepository } from "./database/repositories/users.repository.js";
export {
  COUPON_CALENDAR_TIMEZONE,
  couponCalendarToday,
} from "./database/calendar.js";
export { customerDisplayName } from "./coupons/customer-name.js";
export { createQrToken, hashQrToken } from "./coupons/qr-token.js";
export type { GeoPoint } from "./database/repositories/stores.repository.js";
export { createEnv } from "./env.js";
export {
  createDevelopmentOtpProvider,
  createResendOtpProvider,
  OtpProviderError,
} from "./auth/otp-provider.js";
export type {
  ResendOtpProviderConfig,
  OtpProvider,
} from "./auth/otp-provider.js";
export { AppError, createErrorHandler, notFoundHandler } from "./errors.js";
export { createHealthRouter } from "./health-router.js";
export { validateBody, validateParams, validateQuery } from "./middleware/validation.js";
export { createMemoryRateLimiter, rateLimit } from "./middleware/rate-limit.js";
export type { RateLimiter } from "./middleware/rate-limit.js";
export { AUTH_ROLES, isAuthRole, normalizeRole } from "./roles.js";
export { createStorageEnv } from "./storage/config.js";
export type { StorageEnv } from "./storage/config.js";
export {
  buildImageKeyPrefix,
  createObjectStorage,
  isImageKeyOwnedBy,
} from "./storage/object-storage.js";
export type { ImageOwner, ObjectStorage } from "./storage/object-storage.js";
export {
  mapAdminUser,
  mapCoupon,
  mapCouponClaim,
  mapCouponProduct,
  mapDelivery,
  mapOrder,
  mapProduct,
  mapProfile,
  mapStore,
  mapStoreFollow,
  mapStorePhoto,
} from "./database/mappers.js";
export type {
  ClaimableCouponRecord,
  CouponClaimRecord,
  CouponMetricsRecord,
  CouponProductDetailRecord,
  CouponProductRefRecord,
  CouponRecord,
  CouponRedemptionEntryRecord,
  CouponRedemptionRecord,
  CustomerClaimRecord,
  StoreDistanceRecord,
  StoreFollowRecord,
  StorePhotoRecord,
} from "./database/mappers.js";
export type { BackendEnv } from "./types/env.js";
