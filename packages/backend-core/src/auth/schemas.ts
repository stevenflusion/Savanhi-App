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
