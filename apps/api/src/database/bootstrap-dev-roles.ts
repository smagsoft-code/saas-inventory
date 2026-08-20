import { getOptionalEnvVar, getRequiredEnvVar } from '@saas-inventory/config';
import postgres from 'postgres';

/**
 * Dev/local-only convenience: sets login passwords for the roles migration 0000 creates, from
 * environment variables — never from a hardcoded or migration-committed value (CLAUDE.md §7.4,
 * security.md#secrets-management). Idempotent (ALTER ROLE always succeeds by overwriting).
 *
 * app_tenant and app_platform are both required as of Prompt 04 — the running API process
 * authenticates as app_tenant for ordinary requests (client.ts) and as app_platform for the
 * narrow administrative operations documented in platform-client.ts (self-service registration's
 * `tenants` row, refresh-token tenant resolution). The remaining two roles (app_event_processor,
 * app_public_resolver) are provisioned the same way, from their own env vars, when the deployables
 * that use them (Event Processor, QR resolver) are actually built — set only if present so this
 * script doesn't fail on a fresh dev checkout that hasn't configured them yet.
 */
async function main(): Promise<void> {
  const migratorUrl = getRequiredEnvVar('MIGRATOR_DATABASE_URL');
  const sql = postgres(migratorUrl, { max: 1 });

  const rolePasswords: Array<[role: string, password: string]> = [
    ['app_tenant', getRequiredEnvVar('APP_TENANT_PASSWORD')],
    ['app_platform', getRequiredEnvVar('APP_PLATFORM_PASSWORD')],
  ];

  const optionalRoles: Array<[role: string, envVar: string]> = [
    ['app_event_processor', 'APP_EVENT_PROCESSOR_PASSWORD'],
    ['app_public_resolver', 'APP_PUBLIC_RESOLVER_PASSWORD'],
  ];
  for (const [role, envVar] of optionalRoles) {
    const password = getOptionalEnvVar(envVar, '');
    if (password !== '') {
      rolePasswords.push([role, password]);
    }
  }

  try {
    for (const [role, password] of rolePasswords) {
      // ALTER ROLE ... WITH PASSWORD does not accept a bind parameter in the password position —
      // PostgreSQL's parser rejects `$1` there ("syntax error"), since ALTER ROLE is DDL, not a
      // preparable DML statement (confirmed against a real PostgreSQL instance, PROMPT 03-A).
      // The safe fix: bind the password normally in a SELECT (immune to injection) and have
      // Postgres itself produce a correctly-escaped literal via quote_literal(), then splice that
      // already-safe literal into the DDL string — never our own hand-rolled escaping.
      const [quoted] = await sql<{ quoted_password: string }[]>`select quote_literal(${password}) as quoted_password`;
      if (!quoted) {
        throw new Error(`quote_literal() returned no row for role "${role}"`);
      }
      // role is always one of the fixed literal strings above, never external input.
      await sql.unsafe(`ALTER ROLE "${role}" WITH PASSWORD ${quoted.quoted_password}`);
      console.log(`Password set for role: ${role}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error('Failed to bootstrap dev role passwords:', error);
  process.exitCode = 1;
});
