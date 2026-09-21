/**
 * Framework-agnostic utility functions shared between apps.
 * Business logic does not belong here — only generic, reusable helpers.
 */
import { uuidv7 } from 'uuidv7';

/**
 * Generates a UUIDv7 primary key, in application code, never via a PostgreSQL DEFAULT.
 * See ADR-0016 (docs/decisions/0016-uuid-identifier-strategy.md) — time-ordered ids keep
 * high-write-volume table indexes append-mostly, and the id is known before INSERT so a
 * single transaction can correlate it across multiple tables (e.g. a movement + its outbox event).
 */
export function generateId(): string {
  return uuidv7();
}

export function isNonNullable<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tenant-timezone date math (F18-01 reporting foundation). The only correct source for "today"/
 * "this month" on a tenant is `tenant_settings.timezone` (surfaced on every session response since
 * F18-01, `GAP-TZ-VISIBILITY`) — never the server's clock, never a client's. This turns an IANA
 * zone into the UTC instant of that zone's local midnight, ready to feed a `createdFrom`-shaped
 * half-open lower bound (`toHalfOpenRange`, `apps/api/src/common/reporting/date-range.ts`).
 *
 * Implementation uses only the platform `Intl` API — no dependency, no `new Date()` interpretation
 * of a business period — so it runs identically in `apps/api` (Node) and `apps/web` (Node/browser).
 * It never throws: an unknown/blank zone falls back to UTC midnight so a caller can still render
 * *something*. Ported here from the algorithm `apps/web/src/lib/home/tenant-day.ts` proved first
 * (F17-12) — that file's own `tenantStartOfDayUtc` is untouched (a working, already-tested F17
 * screen depends on its exact import path); this is the same algorithm, now available to
 * `apps/api` and any future reporting caller through one shared, tested source, since packages/api
 * cannot import from apps/web.
 */
function timeZoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((wallClockAsUtc - at.getTime()) / 60_000) * 60_000;
}

/** The UTC `Date` for `year-month-day 00:00:00` as a wall-clock time in `timeZone`. Two passes so a
 * DST change between the guessed instant and the real one is corrected (the one genuinely ambiguous
 * hour per year is close enough for a "today" count). */
function zonedMidnightToUtc(timeZone: string, year: number, month: number, day: number): Date {
  const wallClockGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  let utc = wallClockGuess - timeZoneOffsetMs(timeZone, new Date(wallClockGuess));
  utc = wallClockGuess - timeZoneOffsetMs(timeZone, new Date(utc));
  return new Date(utc);
}

/**
 * ISO-8601 UTC instant of "start of today" in `timeZone`. `now` is injectable for tests.
 */
export function tenantStartOfDayUtc(timeZone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    return zonedMidnightToUtc(timeZone, get('year'), get('month'), get('day')).toISOString();
  } catch {
    // Unknown zone — fall back to UTC midnight rather than throw.
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
}

/**
 * The fixed, application-level role template copied into a newly-created tenant's
 * roles/role_permissions at provisioning time — database.md#rbac-roles-permissions: "The template
 * itself lives in application code (or a small static config), not a database table... copying it
 * into per-tenant rows at provisioning time... is what lets a tenant customize its 'Vendedor' role
 * without touching every other tenant's."
 *
 * Lives in packages/shared (not apps/api or database) so both self-service tenant provisioning
 * (apps/api/src/auth — Prompt 04) and the demo-tenant seed script (database/seeds) consume the
 * exact same source of truth instead of two copies drifting apart. Kept as a single flat export
 * (no re-export barrel) — a `export *` barrel is what caused a real cross-module-system import bug
 * elsewhere in this codebase (see database/seeds/demo-tenant.ts's comment on schema/index.ts).
 *
 * The base RBAC *mechanism* (fixed catalog, tenant-toggleable assignment) is fully specified by
 * database.md. The exact permission-to-role matrix below follows the qualitative hints already
 * given per-permission in database.md's RBAC table (risk level, "rol Vendedor típico",
 * "Administrador únicamente", etc.) — it is a reasonable starting template, not a business rule
 * this architecture pins exhaustively. A tenant's Administrator can always edit/reassign after
 * provisioning (roles are not protected once copied, per the same doc section: "is_system_default...
 * is a label, not a protection mechanism").
 */
export const DEFAULT_ROLE_TEMPLATE_NAMES = ['Administrador', 'Supervisor', 'Vendedor', 'Bodega'] as const;

export type DefaultRoleTemplateName = (typeof DEFAULT_ROLE_TEMPLATE_NAMES)[number];

export const DEFAULT_ROLE_TEMPLATES: Record<DefaultRoleTemplateName, { description: string; permissionCodes: string[] }> = {
  Administrador: {
    description: 'Acceso completo a la configuracion y operacion del tenant.',
    permissionCodes: [
      'catalog.attributes.manage',
      'catalog.qr.manage',
      'pricing.policy.manage',
      'pricing.floor.view',
      'pricing.cost.view',
      'pricing.discount.request',
      'pricing.discount.approve',
      'inventory.transfers.request',
      'inventory.transfers.approve',
      'inventory.transfers.dispatch',
      'inventory.transfers.receive',
      'inventory.returns.manage',
      'import.execute',
      'import.inventory',
      'core.users.locations.manage',
      'core.tenant.update',
      'core.users.read',
      'core.users.create',
      'core.users.update',
      'core.roles.read',
      'core.roles.assign',
      'core.roles.manage',
      'products.view',
      'products.manage',
      'categories.view',
      'categories.manage',
      'warehouses.view',
      'warehouses.manage',
      'locations.view',
      'locations.manage',
      'inventory.view',
      'inventory.adjust',
      'administration.settings.view',
      'administration.settings.manage',
      'sales.customers.view',
      'sales.customers.manage',
      'sales.carts.manage',
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.cancel',
      'sales.returns.view',
      'sales.returns.create',
    ],
  },
  Supervisor: {
    description: 'Aprueba excepciones y transferencias; visibilidad de costos.',
    permissionCodes: [
      'pricing.floor.view',
      'pricing.cost.view',
      'pricing.discount.approve',
      'inventory.transfers.approve',
      'inventory.transfers.dispatch',
      'inventory.transfers.receive',
      'inventory.returns.manage',
      'products.view',
      'categories.view',
      'warehouses.view',
      'locations.view',
      'inventory.view',
      'inventory.adjust',
      'sales.customers.view',
      'sales.customers.manage',
      'sales.carts.manage',
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.cancel',
      'sales.returns.view',
      'sales.returns.create',
    ],
  },
  Vendedor: {
    description: 'Vende y negocia dentro del rango autorizado; sin visibilidad de costos.',
    permissionCodes: [
      'pricing.floor.view',
      'pricing.discount.request',
      'products.view',
      'categories.view',
      'sales.customers.view',
      'sales.customers.manage',
      'sales.carts.manage',
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.cancel',
      'sales.returns.view',
      'sales.returns.create',
    ],
  },
  Bodega: {
    description: 'Opera transferencias, recepciones y devoluciones en las ubicaciones asignadas.',
    permissionCodes: [
      'inventory.transfers.request',
      'inventory.transfers.dispatch',
      'inventory.transfers.receive',
      'inventory.returns.manage',
      'products.view',
      'categories.view',
      'warehouses.view',
      'locations.view',
      'inventory.view',
      'inventory.adjust',
      'sales.returns.view',
    ],
  },
};
