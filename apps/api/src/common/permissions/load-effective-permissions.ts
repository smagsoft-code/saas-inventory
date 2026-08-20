import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '../../database/tenant-context';

/**
 * A user's effective permissions = the union of every permission granted to every role assigned
 * to them (ADR-0009's role -> permission bundle model). Runs inside the caller's tenant
 * transaction (RLS-scoped) — never a cross-tenant read.
 */
export async function loadEffectivePermissions(tx: TenantTransaction, userId: string): Promise<string[]> {
  const rows = await tx.execute<{ permission_code: string }>(sql`
    select distinct rp.permission_code
    from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = ${userId}
  `);
  return rows.map((row) => row.permission_code);
}
