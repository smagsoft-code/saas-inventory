import { SetMetadata } from '@nestjs/common';

/**
 * Declares that a route requires **at least one** of the listed permission codes (ADR-0009's fixed
 * catalog) — the OR counterpart to {@link RequirePermissions}'s AND semantics, checked by
 * PermissionsGuard against the caller's effective permissions.
 *
 * Use this only where a single read is legitimately reachable by two distinct roles whose
 * permission sets do not overlap — e.g. the exceptional-discount queue, which both the requester
 * (`pricing.discount.request`) and the approver (`pricing.discount.approve`) must be able to read.
 * A route may carry both `@RequirePermissions(...)` and `@RequireAnyPermission(...)`; the guard
 * then enforces every AND code **and** at least one ANY code.
 */
export const ANY_PERMISSIONS_KEY = 'requiredAnyPermissions';
export const RequireAnyPermission = (...permissions: string[]) => SetMetadata(ANY_PERMISSIONS_KEY, permissions);
