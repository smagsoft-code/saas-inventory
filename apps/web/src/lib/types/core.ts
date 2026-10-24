/** Mirrors apps/api/src/core's response DTOs — kept local to the frontend (no shared package for
 * API response shapes exists yet, same convention as lib/types/session.ts's Session). */

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  isDemo: boolean;
  createdAt: string;
  /** Present only when the company has a logo: its last change in ms (cache-buster for
   * `GET /tenant/logo`). */
  logoVersion?: number;
}

export interface TenantUser {
  id: string;
  email: string;
  fullName: string;
  status: string;
  roleNames: string[];
  lastLoginAt?: string;
  createdAt: string;
}

export interface PaginatedUsers {
  data: TenantUser[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  isSystemDefault: boolean;
  permissionCodes: string[];
  /** ADR-0034: true when this role is currently assigned to the caller — `PUT
   * /roles/:id/permissions` always rejects (403 `ROLE_SELF_PERMISSION_ESCALATION`) when this is
   * true, regardless of holding `core.roles.manage`. */
  isAssignedToCaller: boolean;
}

export interface PermissionCatalogItem {
  code: string;
  module: string;
  description: string;
}
