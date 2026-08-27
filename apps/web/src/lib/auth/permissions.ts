import type { PermissionCode } from './permission-codes';

/**
 * The frontend permission model (Prompt 016 §14–§15). A checker is built from the exact
 * `permissions` array `GET /auth/me` returned for this user — never from a role name, never from
 * anything the client could set. It only decides whether to *render* a control; every request is
 * still authorized by `PermissionsGuard` server-side (CLAUDE.md §7.6), and a 403 coming back
 * anyway is handled as a normal error, not a bug.
 */
export interface PermissionChecker {
  /** True if the user holds this exact permission code. */
  can(code: PermissionCode): boolean;
  /** True if the user holds at least one of the codes (empty list → true: "nothing required"). */
  canAny(codes: readonly PermissionCode[]): boolean;
  /** True if the user holds every code (empty list → true). */
  canAll(codes: readonly PermissionCode[]): boolean;
}

export function createPermissionChecker(permissions: readonly string[]): PermissionChecker {
  const granted = new Set(permissions);
  return {
    can: (code) => granted.has(code),
    canAny: (codes) => codes.length === 0 || codes.some((code) => granted.has(code)),
    canAll: (codes) => codes.every((code) => granted.has(code)),
  };
}
