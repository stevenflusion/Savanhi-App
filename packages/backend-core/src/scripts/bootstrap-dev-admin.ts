import { randomUUID } from "node:crypto";
import { createBackendContext, createEnv } from "../index.js";

function readBootstrapEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

async function main() {
  const email = readBootstrapEnv("DEV_ADMIN_EMAIL", "dev.admin@savanhi.local");
  const fullName = readBootstrapEnv("DEV_ADMIN_FULL_NAME", "Developer Admin");

  const env = createEnv({
    serviceName: "bootstrap-dev-admin",
    defaultPort: 4300,
  });

  const context = createBackendContext(env, { defaultRegistrationRole: "admin" });
  const normalizedEmail = email.toLowerCase();

  const existing = await context.repositories.users.findByEmail(normalizedEmail);
  if (existing) throw new Error(`An admin profile already exists for ${email}.`);
  const profile = await context.repositories.users.ensure({
    id: randomUUID(),
    email: normalizedEmail,
    fullName,
    role: "admin",
    active: true,
    emailVerifiedAt: null,
    registrationStatus: "completed",
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        user: profile,
        note: "Verify this email through OTP before using the admin account.",
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
