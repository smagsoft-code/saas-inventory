/** Request-derived context threaded through to AuditLogService.record() — same shape as
 * catalog/catalog-audit-meta.ts / inventory/inventory-audit-meta.ts, kept as its own small file
 * here rather than imported cross-module. */
export interface AuditMeta {
  correlationId: string | undefined;
  ipAddress: string | undefined;
}
