/**
 * Safety rules of the QA seed (`seed-qa-data.ts`, D-8E.26-B4.1), as pure functions with no I/O so they can be unit-tested with mocks.
 *
 * The seed writes through the real HTTP API. These rules decide, BEFORE any request, whether it may run at all: which tenant it is allowed
 * to touch (explicit, never inferred), which API it may talk to (loopback only), whether it may write (explicit `--yes`) and what a
 * session must look like. Every refusal is a `SeedGuardError` with a message that names no secret.
 */

export class SeedGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedGuardError';
  }
}

export type SeedMode = 'check' | 'create' | 'normal';

export interface SeedArgs {
  readonly mode: SeedMode;
  readonly yes: boolean;
}

export interface SeedConfig extends SeedArgs {
  /** The ONLY tenant the seed may act on. Comes from `QA_SEED_TENANT_SLUG`; there is no default and no fallback. */
  readonly tenantSlug: string;
  /** Always a loopback http(s) URL (see `assertLoopbackApi`). */
  readonly apiBase: string;
}

/** Stable references the seed leaves in the data it creates, so that a repeat run recognises them instead of duplicating them. */
export const QA_SEED_MARKERS = {
  /** `reason` of the initial-stock RECEIPT adjustments. */
  stockReason: 'seed-qa:v1:stock',
  /** The reason written by the first version of the seed (before markers existed): still recognised, never written again. */
  legacyStockReason: 'Existencia inicial — dataset de pruebas QA',
  /** `notes` of the two transfers. */
  transferNotes: ['seed-qa:v1:transfer-1 Reposición Sucursal Norte QA', 'seed-qa:v1:transfer-2 Segunda reposición — pendiente de despacho'],
  legacyTransferNotes: ['Reposición Sucursal Norte QA', 'Segunda reposición — pendiente de despacho'],
} as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
export const DEFAULT_API_BASE = 'http://127.0.0.1:4000';

/** `--check` | `--create` | (nothing) plus `--yes`. Anything else is refused. */
export function parseSeedArgs(rawArgv: readonly string[]): SeedArgs {
  // pnpm forwards a bare `--` separator to the script; it carries no meaning here.
  const argv = rawArgv.filter((arg) => arg !== '--');
  const known = new Set(['--check', '--create', '--yes']);
  const unknown = argv.find((arg) => !known.has(arg));
  if (unknown !== undefined) throw new SeedGuardError(`Unknown option: ${unknown}. Supported: --check, --create, --yes.`);
  const check = argv.includes('--check');
  const create = argv.includes('--create');
  const yes = argv.includes('--yes');
  if (check && create) throw new SeedGuardError('Use either --check or --create, not both.');
  if (check && yes) throw new SeedGuardError('--check never writes; --yes is not accepted with it.');
  return { mode: check ? 'check' : create ? 'create' : 'normal', yes };
}

/** Only `http(s)` on 127.0.0.1 or localhost, with no credentials in the URL. A remote host is never enabled by any variable. */
export function assertLoopbackApi(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SeedGuardError('The API URL is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SeedGuardError('The API URL must be http or https.');
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new SeedGuardError(`The seed only talks to a loopback API (127.0.0.1 or localhost); "${url.hostname}" is refused. There is no option to enable a remote host.`);
  }
  if (url.username !== '' || url.password !== '') throw new SeedGuardError('The API URL must not contain credentials.');
  return url;
}

/**
 * Builds the run configuration. `QA_SEED_TENANT_SLUG` is mandatory (no default, no fallback to `qa-tenant` or anything else). An optional
 * `QA_SEED_API_URL` can only point at another loopback address/port. Writing modes require `--yes`.
 */
export function resolveSeedConfig(env: Readonly<Record<string, string | undefined>>, args: SeedArgs): SeedConfig {
  const tenantSlug = (env['QA_SEED_TENANT_SLUG'] ?? '').trim();
  if (tenantSlug === '') {
    throw new SeedGuardError('QA_SEED_TENANT_SLUG is not set. Name the QA tenant explicitly (there is no default and no automatic selection).');
  }
  if (!SLUG.test(tenantSlug)) throw new SeedGuardError('QA_SEED_TENANT_SLUG is not a valid tenant slug.');
  const apiBase = assertLoopbackApi((env['QA_SEED_API_URL'] ?? '').trim() || DEFAULT_API_BASE).origin;
  if (args.mode !== 'check' && !args.yes) {
    throw new SeedGuardError(`This run would write to tenant "${tenantSlug}". Re-run with --yes to confirm, or with --check to inspect without writing.`);
  }
  return { ...args, tenantSlug, apiBase };
}

export interface LoginResult {
  readonly status?: string;
  readonly user?: { readonly tenantSlug?: string; readonly status?: string; readonly permissions?: readonly string[] };
  readonly availableTenants?: readonly unknown[];
}

/** The permission that lifts `GET /orders` from "the caller's own orders" to "every seller's orders" (order-seller-scope.ts). */
export const VIEW_ALL_ORDERS_PERMISSION = 'sales.orders.view_all';

/** What `GET /inventory/location-scope` answers: `unrestricted` is true only for the founding Administrador (ADR-0035). */
export interface OperatingScope {
  readonly unrestricted?: unknown;
  readonly locationIds?: unknown;
}

/**
 * B5 (D-8E.26-B4.5). `GET /orders` is filtered by the backend on TWO axes the caller cannot see in the response: without
 * `sales.orders.view_all` it returns only the orders the caller placed, and a caller restricted to some locations only gets the orders of
 * those locations. A short list is therefore NOT proof that no order exists. The seed may reason about "no previous orders" only when both
 * axes are proven open: the session holds `sales.orders.view_all` AND the operating scope is unrestricted. Anything else — a missing or
 * malformed answer included — refuses, before anything is written. No permission is granted or widened to make this pass.
 */
export function assertOrderListIsComplete(permissions: readonly string[] | undefined, scope: OperatingScope | null | undefined): void {
  if (!Array.isArray(permissions) || !permissions.includes(VIEW_ALL_ORDERS_PERMISSION)) {
    throw new SeedGuardError(
      `The QA account does not hold ${VIEW_ALL_ORDERS_PERMISSION} (or the session did not report its permissions), so GET /orders would list only the orders it placed itself. ` +
        'The seed cannot tell whether other orders exist and will not create orders on that basis. Nothing was changed.',
    );
  }
  if (scope === undefined || scope === null || typeof scope !== 'object' || typeof scope.unrestricted !== 'boolean') {
    throw new SeedGuardError('The location scope of the QA account could not be read in a recognisable form; the seed cannot prove that GET /orders lists every location. Nothing was changed.');
  }
  if (!scope.unrestricted) {
    throw new SeedGuardError('The QA account is restricted to some locations, so GET /orders omits the orders of the others. The seed cannot tell whether they exist and will not create orders. Nothing was changed.');
  }
}

/**
 * The login must have produced a session for exactly the requested tenant. The backend only issues a session for an ACTIVE membership of an
 * active tenant, so an inactive membership or a suspended tenant never reaches this point as `authenticated`; two or more active memberships
 * come back as `tenant_selection_required` and are refused here — the seed never picks one.
 */
export function assertSessionMatchesTenant(login: LoginResult, expectedSlug: string): void {
  if (login.status === 'tenant_selection_required') {
    throw new SeedGuardError('The QA account has more than one active membership; the seed will not choose a tenant. Nothing was changed.');
  }
  if (login.status !== 'authenticated' || login.user === undefined) {
    throw new SeedGuardError('The login did not produce a session (inactive membership, suspended tenant or wrong credentials). Nothing was changed.');
  }
  if (login.user.status !== undefined && login.user.status !== 'active') throw new SeedGuardError('The QA user is not active. Nothing was changed.');
  if (login.user.tenantSlug !== expectedSlug) {
    throw new SeedGuardError(`The session belongs to tenant "${login.user.tenantSlug ?? '?'}", not to the requested "${expectedSlug}". Nothing was changed.`);
  }
}

/** The tenant returned by `GET /tenant` must be the requested one and active. */
export function assertTenantActive(tenant: { readonly slug?: string; readonly status?: string }, expectedSlug: string): void {
  if (tenant.slug !== expectedSlug) throw new SeedGuardError(`The API reports tenant "${tenant.slug ?? '?'}", not "${expectedSlug}". Nothing was changed.`);
  if (tenant.status !== 'active') throw new SeedGuardError(`Tenant "${expectedSlug}" is "${tenant.status ?? '?'}", not active. The seed never reactivates a tenant.`);
}

export interface OperationalCounts {
  readonly products: number;
  readonly warehouses: number;
  readonly customers: number;
  readonly orders: number;
  readonly movements: number;
}

/** `--create` only builds the initial dataset in a tenant that holds no operational data at all. */
export function assertTenantOperationallyEmpty(counts: OperationalCounts, tenantSlug: string): void {
  const filled = Object.entries(counts).filter(([, n]) => n > 0).map(([name, n]) => `${name}=${String(n)}`);
  if (filled.length > 0) {
    throw new SeedGuardError(`--create refused: tenant "${tenantSlug}" already has operational data (${filled.join(', ')}). Use --check to inspect it; the seed does not repair existing data.`);
  }
}
