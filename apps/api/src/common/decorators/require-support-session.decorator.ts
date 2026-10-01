import { SetMetadata } from '@nestjs/common';
import type { SupportSessionMode } from '../../auth/repositories/platform-support-sessions.repository';

export const SUPPORT_SESSION_MODE_KEY = 'requiredSupportSessionMode';

/** ADR-0036 — marks a `@PlatformOnly()` route as additionally requiring a live, unexpired
 * `platform_support_sessions` row for the caller on the route's `:tenantId`, in at least the given
 * mode. `'read'` is satisfied by either an active `read` or `write` session (write implies read);
 * `'write'` requires exactly a `write` session. Enforced by `SupportSessionGuard`
 * (common/guards/support-session.guard.ts), never by `PermissionsGuard` — this is a platform-level
 * temporary grant, not tenant RBAC (ADR-0032's "never protect platform operations with the tenant
 * PermissionsGuard" extended to this new, narrower platform capability). */
export const RequireSupportSession = (mode: SupportSessionMode) => SetMetadata(SUPPORT_SESSION_MODE_KEY, mode);
