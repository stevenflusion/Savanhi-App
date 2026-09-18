import type { AuthUser } from "@repo/api-contracts/auth";
import type { UserStatusRequest } from "@repo/api-contracts/users";
import { and, desc, eq, sql } from "drizzle-orm";
import { AppError } from "../../errors.js";
import type { DatabaseConnection } from "../connection.js";
import { roles, users } from "../schema.js";
import { mapAdminUser, mapProfile } from "../mappers.js";

export function createUsersRepository(db: DatabaseConnection) {
  async function read(id: string) {
    const [row] = await db
      .select({ user: users, roleName: roles.name })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, id));
    return row ? { ...row.user, roleName: row.roleName } : null;
  }
  return {
    async ensure(user: AuthUser) {
      const [role] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, user.role));
      if (!role)
        throw new AppError(`Role ${user.role} is not configured.`, 500);
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, user.id));
      const values = {
        roleId: role.id,
        email: user.email,
        emailNormalized: user.email.toLowerCase(),
        fullName: user.fullName,
        active: user.active,
        emailVerifiedAt: user.emailVerifiedAt
          ? new Date(user.emailVerifiedAt)
          : null,
        registrationStatus: user.registrationStatus,
        updatedAt: new Date(),
      };
      if (existing)
        await db.update(users).set(values).where(eq(users.id, user.id));
      else await db.insert(users).values({ id: user.id, ...values });
      const row = await read(user.id);
      if (!row) throw new AppError("Unable to persist user profile.", 502);
      return mapProfile(row);
    },
    async findById(id: string) {
      const row = await read(id);
      return row ? mapProfile(row) : null;
    },
    async findByEmail(email: string) {
      const [row] = await db
        .select({ user: users, roleName: roles.name })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(eq(users.email, email.toLowerCase()));
      return row ? mapProfile({ ...row.user, roleName: row.roleName }) : null;
    },
    async listAdminUsers() {
      const rows = await db
        .select({ user: users, roleName: roles.name })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .orderBy(desc(users.createdAt));
      return rows.map((row) =>
        mapAdminUser({ ...row.user, roleName: row.roleName }),
      );
    },
    async updateProfile(id: string, payload: { fullName: string }) {
      await db
        .update(users)
        .set({
          fullName: payload.fullName,
          registrationStatus: sql`case when ${users.registrationStatus} = 'profile_required' then 'store_required'::registration_status else ${users.registrationStatus} end`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));
      const row = await read(id);
      if (!row) throw new AppError("User not found.", 404);
      return mapProfile(row);
    },
    async updateStatus(id: string, payload: UserStatusRequest) {
      await db
        .update(users)
        .set({ active: payload.active, updatedAt: new Date() })
        .where(eq(users.id, id));
      const row = await read(id);
      if (!row) throw new AppError("User not found.", 404);
      return mapAdminUser(row);
    },
    async count() {
      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users);
      return Number(result?.count ?? 0);
    },
  };
}
