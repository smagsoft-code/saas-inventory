/** Request-derived context threaded through to AuditLogService.record() — same shape as
 * catalog/catalog-audit-meta.ts / core/users/users.service.ts's AuditMeta, kept as its own small
 * file here rather than imported cross-module, since QR's declared dependencies are CATALOG/
 * INVENTORY (modules.md), not CORE's users feature specifically. */
export interface AuditMeta {
  correlationId: string | undefined;
  ipAddress: string | undefined;
}
