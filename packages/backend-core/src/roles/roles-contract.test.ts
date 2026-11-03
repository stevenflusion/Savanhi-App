import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { AUTH_ROLES } from "@repo/api-contracts/auth";
import { mapProfile } from "../database/mappers.js";
import type { users } from "../database/schema.js";
import { isAuthRole, normalizeRole } from "../roles.js";

type UserRow = typeof users.$inferSelect & { roleName: string };

function userRow(roleName: string): UserRow {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: randomUUID(),
    roleId: randomUUID(),
    email: "stored-role@example.test",
    emailNormalized: "stored-role@example.test",
    passwordHash: null,
    fullName: "Stored Role",
    active: true,
    emailVerifiedAt: now,
    registrationStatus: "completed",
    createdAt: now,
    updatedAt: now,
    roleName,
  };
}

/**
 * `marca` is frozen and out of MVP scope, but it must stay a known role:
 * `normalizeRole` falls back to `tendero`, so forgetting it would silently
 * promote a stored `marca` user to `tendero`.
 */
test("a stored marca role is never remapped to tendero", () => {
  assert.equal(mapProfile(userRow("marca")).role, "marca");
  assert.equal(normalizeRole("marca", "tendero"), "marca");
  assert.equal(isAuthRole("marca"), true);
  assert.ok(AUTH_ROLES.includes("marca" as never));
});

test("an unknown stored role still falls back to tendero", () => {
  assert.equal(mapProfile(userRow("brand-manager")).role, "tendero");
  assert.equal(normalizeRole("brand-manager", "tendero"), "tendero");
  assert.equal(isAuthRole("brand-manager"), false);
});

test("every known role maps through untouched", () => {
  for (const role of AUTH_ROLES) {
    assert.equal(mapProfile(userRow(role)).role, role);
  }
});
