/**
 * Platform-admin (SuperAdmin) bootstrap — ADR-0032. `platform_admins` has no self-service
 * registration endpoint by design (multi-tenancy.md's "narrow, explicit" SuperAdmin posture — a
 * public endpoint that could mint a SuperAdmin account would itself be the P0 privilege-escalation
 * risk threat-model.md names). This is the out-of-band provisioning path instead: an explicit,
 * opt-in script an operator runs once per environment, never wired into `db:seed`'s default run
 * (unlike the demo tenant, a platform admin is not demo data and must never be created as a side
 * effect of routine seeding).
 *
 * Idempotent — re-running with the same PLATFORM_ADMIN_EMAIL updates the existing row's password/
 * name rather than erroring on the unique constraint, so rotating a lost credential is the same
 * command as the initial bootstrap.
 *
 * Usage:
 *   PLATFORM_ADMIN_EMAIL=root@example.com PLATFORM_ADMIN_PASSWORD=... \
 *     MIGRATOR_DATABASE_URL=... pnpm --filter @saas-inventory/database seed:platform-admin
 */
import * as argon2 from 'argon2';
import { getOptionalEnvVar, getRequiredEnvVar } from '@saas-inventory/config';
import { generateId } from '@saas-inventory/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
// Direct file import, not the schema barrel — see demo-tenant.ts's header comment for why an ESM
// consumer across the apps/api (CommonJS) package boundary must import numbered schema files
// directly rather than through schema/index.ts's `export *` chain.
import { platformAdmins } from '../../apps/api/src/database/schema/01-platform';

async function seedPlatformAdmin(): Promise<void> {
  const email = getRequiredEnvVar('PLATFORM_ADMIN_EMAIL').trim().toLowerCase();
  const password = getRequiredEnvVar('PLATFORM_ADMIN_PASSWORD');
  const fullName = getOptionalEnvVar('PLATFORM_ADMIN_FULL_NAME', 'Platform Administrator');

  if (password.length < 12) {
    throw new Error('PLATFORM_ADMIN_PASSWORD must be at least 12 characters — refusing to seed a weak SuperAdmin credential.');
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: Number(getOptionalEnvVar('ARGON2_MEMORY_COST_KIB', '19456')),
    timeCost: Number(getOptionalEnvVar('ARGON2_TIME_COST', '2')),
    parallelism: Number(getOptionalEnvVar('ARGON2_PARALLELISM', '1')),
  });

  // app_platform (not app_migrator) — this is an ordinary application-data write to a table
  // app_platform already owns operationally, not a schema/DDL operation. Mirrors
  // TenantsPlatformRepository's own connection choice for the equivalent `tenants` writes.
  const client = postgres(getRequiredEnvVar('APP_PLATFORM_DATABASE_URL'), { max: 1 });
  try {
    const db = drizzle(client);
    const [existing] = await db.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.email, email));

    if (existing) {
      await db.update(platformAdmins).set({ passwordHash, fullName, status: 'active' }).where(eq(platformAdmins.id, existing.id));
      console.log(`Platform admin "${email}" already existed — password/name updated.`);
      return;
    }

    await db.insert(platformAdmins).values({ id: generateId(), email, passwordHash, fullName });
    console.log(`Platform admin "${email}" created.`);
  } finally {
    await client.end();
  }
}

seedPlatformAdmin().catch((error: unknown) => {
  console.error('Seeding platform admin failed:', error);
  process.exitCode = 1;
});
