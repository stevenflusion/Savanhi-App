import type { AuthRole } from "./auth.js";

export type UserStatusRequest = {
  active: boolean;
};

export type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  role: AuthRole;
  active: boolean;
  createdAt: string | null;
};
