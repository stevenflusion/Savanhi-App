export { createBackendApp } from "./app.js";
export { createAuthRouter, createRequireAuth, createRequireRole } from "./auth/router.js";
export { createAuthService } from "./auth/service.js";
export type { AuthService } from "./auth/service.js";
export { createBackendContext } from "./context/backend-context.js";
export type { BackendContext, BackendRepositories } from "./context/backend-context.js";
export { createDatabaseConnection } from "./database/connection.js";
export type { DatabaseConnection } from "./database/connection.js";
export { createAuthLogsRepository } from "./database/repositories/auth-logs.repository.js";
export { createBrandsRepository } from "./database/repositories/brands.repository.js";
export { createCatalogRepository } from "./database/repositories/catalog.repository.js";
export { createDeliveriesRepository } from "./database/repositories/deliveries.repository.js";
export { createOrdersRepository } from "./database/repositories/orders.repository.js";
export { createProductsRepository } from "./database/repositories/products.repository.js";
export { createStoresRepository } from "./database/repositories/stores.repository.js";
export { createUsersRepository } from "./database/repositories/users.repository.js";
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
export { mapAdminUser, mapBrand, mapDelivery, mapOrder, mapProduct, mapProfile, mapStore } from "./database/mappers.js";
export type { BackendEnv } from "./types/env.js";
