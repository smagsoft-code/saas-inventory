import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as SuperAdmin-only (multi-tenancy.md#superadmin-vs-tenant) — TenantGuard routes it
 * to the platform-principal check instead of ordinary tenant-context resolution, and it never
 * loads/requires tenant RBAC permissions. Distinct from @Public(): the route still requires a
 * verified access token, just not a tenant-scoped one.
 */
export const IS_PLATFORM_ONLY_KEY = 'isPlatformOnly';
export const PlatformOnly = () => SetMetadata(IS_PLATFORM_ONLY_KEY, true);
