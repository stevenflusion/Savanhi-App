import type { AuthUser } from "@repo/api-contracts/auth";
import type { UserStatusRequest } from "@repo/api-contracts/users";
import { and, desc, eq, sql } from "drizzle-orm";
import { AppError } from "../../errors.js";
import type { DatabaseConnection } from "../connection.js";
import { couponCalendarToday } from "../calendar.js";
import { roles, users } from "../schema.js";
import { mapAdminUser, mapProfile } from "../mappers.js";

/**
 * Where onboarding goes when a profile is saved (C2). The next state depends on
 * the ROLE: a `client` has no store step, so a saved profile completes its
 * registration, while a `tendero` still has to create its store through the
 * tendero-only `registration/complete` route. Every other role keeps the
 * tendero path, which is what it had before this rule existed.
 *
 * The role is read as a subquery inside the same statement that writes, so
 * there is no window in which the status could be decided from a role the row
 * no longer has. A status that already moved past `profile_required` is never
 * degraded, in either direction. Both profile writes share this one expression,
 * so the two can never disagree about it.
 */
const registrationStatusAfterProfileSave = sql`case
  when ${users.registrationStatus} <> 'profile_required'
    then ${users.registrationStatus}
  when (
    select ${roles.name} from ${roles} where ${roles.id} = ${users.roleId}
  ) = 'client' then 'completed'::registration_status
  else 'store_required'::registration_status
end`;

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
    /**
     * Saving a name is where onboarding advances (C2); see
     * `registrationStatusAfterProfileSave` for the role-dependent next state.
     */
    async updateProfile(id: string, payload: { fullName: string }) {
      await db
        .update(users)
        .set({
          fullName: payload.fullName,
          registrationStatus: registrationStatusAfterProfileSave,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));
      const row = await read(id);
      if (!row) throw new AppError("User not found.", 404);
      return mapProfile(row);
    },
    /**
     * What the customer API needs to decide eligibility (C9): the name and the
     * birth date as stored, and today's `America/Bogota` calendar day as a
     * date-only string read in the same statement, so the age is never judged
     * against the server's or the device's own idea of today.
     */
    async readCustomerProfile(id: string) {
      const [row] = await db
        .select({
          fullName: users.fullName,
          birthDate: users.birthDate,
          today: sql<string>`to_char(${couponCalendarToday()}, 'YYYY-MM-DD')`,
        })
        .from(users)
        .where(eq(users.id, id));
      return row ?? null;
    },
    /**
     * The customer's profile write (C8): name and birth date in ONE statement,
     * advancing the registration status the same way saving a name does. The
     * WHERE carries the role, so a call for anyone who is not a `client`
     * changes nothing and answers `false` — this statement can never give a
     * tendero a birth date, whatever route reached it.
     */
    async updateCustomerProfile(
      id: string,
      payload: { fullName: string; birthDate: string },
    ) {
      const updated = await db
        .update(users)
        .set({
          fullName: payload.fullName,
          birthDate: payload.birthDate,
          registrationStatus: registrationStatusAfterProfileSave,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(users.id, id),
            sql`(
              select ${roles.name} from ${roles} where ${roles.id} = ${users.roleId}
            ) = 'client'`,
          ),
        )
        .returning({ id: users.id });
      return updated.length > 0;
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
