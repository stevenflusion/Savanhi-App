import { REGISTRATION_ROLES } from "@repo/api-contracts/auth";
import { z } from "zod";

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const otpRequestSchema = z.object({
  email: z.string().email(),
});

export const otpVerifySchema = z.object({
  email: z.string().email(),
  challengeId: z.string().uuid(),
  token: z.string().min(1),
  /**
   * Which app is registering (C1). The enum is a CLOSED set of exactly the two
   * app roles, so `admin`, `marca`, `delivery` and any unknown value are
   * rejected here — before a statement runs, which is what makes a refused
   * registration leave no account behind.
   *
   * Absent keeps today's behaviour: the process's `defaultRegistrationRole`.
   */
  registrationRole: z.enum(REGISTRATION_ROLES).optional(),
});

export const updateProfileSchema = z.object({
  fullName: z.string().min(1),
});

export const completeRegistrationSchema = z.object({
  fullName: z.string().trim().min(1),
  store: z.object({
    name: z.string().trim().min(1),
    address: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    paymentMethod: z.enum(["efectivo", "pichincha"]).optional(),
  }),
});
