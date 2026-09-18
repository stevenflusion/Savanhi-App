import type { AuthRole } from "@repo/api-contracts/auth";
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  type Router as ExpressRouter,
} from "express";
import { AppError } from "../errors.js";
import { validateBody } from "../middleware/validation.js";
import {
  completeRegistrationSchema,
  refreshSchema,
  otpRequestSchema,
  otpVerifySchema,
  updateProfileSchema,
} from "./schemas.js";
import type { AuthService } from "./service.js";
import {
  createMemoryRateLimiter,
  rateLimit,
} from "../middleware/rate-limit.js";

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

export function createRequireAuth(authService: AuthService) {
  return function requireAuth(allowedRoles: AuthRole[] = []) {
    return async (req: Request, _res: Response, next: NextFunction) => {
      try {
        const token = getBearerToken(req);
        if (!token) throw new AppError("Missing access token.", 401);

        const user = await authService.getUserFromAccessToken(token);
        if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
          throw new AppError("You do not have access to this resource.", 403);
        }

        req.auth = { token, user };
        next();
      } catch (error) {
        next(error);
      }
    };
  };
}

export function createRequireRole(authService: AuthService) {
  const requireAuth = createRequireAuth(authService);
  return (allowedRoles: AuthRole[]) => requireAuth(allowedRoles);
}

export function createAuthRouter(
  authService: AuthService,
  {
    limits = {
      otpRequest: 5,
      otpVerify: 10,
      refresh: 30,
    },
  } = {},
): {
  authRouter: ExpressRouter;
  requireAuth: (allowedRoles?: AuthRole[]) => RequestHandler;
  requireRole: (allowedRoles: AuthRole[]) => RequestHandler;
} {
  const router = Router();
  const requireAuth = createRequireAuth(authService);
  const requireRole = createRequireRole(authService);
  const limiter = createMemoryRateLimiter();
  const requestMeta = (req: Request) => ({
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });

  router.post(
    "/auth/otp/request",
    validateBody(otpRequestSchema),
    async (req, res, next) => {
      try {
        const result = await authService.requestOtp(
          req.body.email,
          requestMeta(req),
        );
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/auth/otp/verify",
    validateBody(otpVerifySchema),
    async (req, res, next) => {
      try {
        const { email, challengeId, token } = req.body;
        const result = await authService.verifyOtp(
          { email, challengeId, token },
          requestMeta(req),
        );
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/auth/me", requireAuth(), (req, res) => {
    res.status(200).json({ user: req.auth?.user });
  });

  router.patch(
    "/auth/me",
    requireAuth(),
    validateBody(updateProfileSchema),
    async (req, res, next) => {
      try {
        const user = await authService.updateProfile(
          req.auth?.user.id ?? "",
          req.body,
        );
        res.status(200).json({ user });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/auth/registration/complete",
    requireAuth(["tendero"]),
    validateBody(completeRegistrationSchema),
    async (req, res, next) => {
      try {
        const result = await authService.completeRegistration(
          req.auth?.user.id ?? "",
          req.body,
        );
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post("/auth/logout", requireAuth(), async (req, res, next) => {
    try {
      await authService.signOut(req.auth?.token ?? "");
      res.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/auth/refresh",
    rateLimit(limiter, "refresh", limits.refresh),
    validateBody(refreshSchema),
    async (req, res, next) => {
      try {
        const session = await authService.refreshSession(
          req.body.refreshToken,
          requestMeta(req),
        );
        res.status(200).json({ session });
      } catch (error) {
        next(error);
      }
    },
  );

  return { authRouter: router, requireAuth, requireRole };
}
