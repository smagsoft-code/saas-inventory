import { SetMetadata } from '@nestjs/common';

/** Declares the permission code(s) (ADR-0009's fixed catalog) a route requires, checked by
 * PermissionsGuard against the caller's effective permissions. A route with no declaration is
 * allowed through PermissionsGuard unchecked (authentication-only) — this module ships the
 * mechanism for future business modules; no auth endpoint in this phase needs a specific
 * permission (only authentication). */
export const PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
