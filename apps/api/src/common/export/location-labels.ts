import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '../../database/tenant-context';

/** "Sucursal · Almacén" for every location id given — one batched query, never one per row. */
export async function loadLocationLabels(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const labels = new Map<string, string>();
  if (unique.length === 0) return labels;
  return withTenantTransaction(tenantId, async (tx) => {
    const rows = await tx.execute<{ id: string; label: string }>(sql`
      select l.id as "id", (w.name || ' · ' || l.name) as "label"
      from locations l
      join warehouses w on w.tenant_id = l.tenant_id and w.id = l.warehouse_id
      where l.tenant_id = ${tenantId} and l.id in (${sql.join(unique.map((id) => sql`${id}`), sql`, `)})`);
    for (const row of rows) labels.set(row.id, row.label);
    return labels;
  });
}
