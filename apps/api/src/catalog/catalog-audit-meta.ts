/** Request-derived context threaded through to AuditLogService.record() — same shape as
 * core/users/users.service.ts's AuditMeta, kept as its own small file here rather than imported
 * cross-module, since CATALOG's only declared dependency is CORE (modules.md), not CORE's users
 * feature specifically. */
export interface AuditMeta {
  correlationId: string | undefined;
  ipAddress: string | undefined;
}
