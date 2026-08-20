/** Mirrors apps/api/src/core's response DTOs — kept local to the frontend (no shared package for
 * API response shapes exists yet, same convention as lib/current-user.ts's CurrentUser). */

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  isDemo: boolean;
  createdAt: string;
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
}
