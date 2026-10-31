/**
 * Safety rules of `seed-test-product-images.ts` (D-8E.26-B4.1), as pure functions with no I/O so they can be unit-tested with mocks.
 *
 * That script writes product images DIRECTLY to the database of a tenant. These rules decide, before any connection is opened or any
 * object is uploaded, whether it may run at all: the tenant must be named explicitly, must be on a fixed allowlist of QA tenants, must be
 * active, both database URLs must be the SAME development database (saas_inventory_dev, one exact port) and S3_ENDPOINT the local dev S3
 * shim (D-8E.26-B4.3), and writing needs `--yes`. Nothing is inferred from a name or a default.
 */

export class ImageSeedGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageSeedGuardError';
  }
}

/** The only tenants this script may ever write to. Extending it is a code change on purpose; no environment variable can add to it. */
export const QA_IMAGE_SEED_ALLOWLIST: readonly string[] = ['qa-dev-tenant'];
/** Named explicitly even though they are outside the allowlist, so the refusal says why. */
export const PROTECTED_TENANT_SLUGS: readonly string[] = ['muebleria-elegante'];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export interface ImageSeedArgs {
  readonly yes: boolean;
}

export function parseImageSeedArgs(argv: readonly string[]): ImageSeedArgs {
  const unknown = argv.find((arg) => arg !== '--yes');
  if (unknown !== undefined) throw new ImageSeedGuardError(`Unknown option: ${unknown}. Supported: --yes.`);
  return { yes: argv.includes('--yes') };
}

/** `SEED_TENANT_SLUG` is mandatory (no default); it must be an allowlisted QA tenant; the write needs `--yes`. */
export function resolveImageSeedTarget(env: Readonly<Record<string, string | undefined>>, args: ImageSeedArgs): { slug: string } {
  const slug = (env['SEED_TENANT_SLUG'] ?? '').trim();
  if (slug === '') throw new ImageSeedGuardError('SEED_TENANT_SLUG is not set. Name the QA tenant explicitly (there is no default).');
  if (!SLUG.test(slug)) throw new ImageSeedGuardError('SEED_TENANT_SLUG is not a valid tenant slug.');
  if (PROTECTED_TENANT_SLUGS.includes(slug)) throw new ImageSeedGuardError(`Tenant "${slug}" is protected; this script never writes to it.`);
  if (!QA_IMAGE_SEED_ALLOWLIST.includes(slug)) {
    throw new ImageSeedGuardError(`Tenant "${slug}" is not on the QA allowlist (${QA_IMAGE_SEED_ALLOWLIST.join(', ')}); refusing.`);
  }
  if (!args.yes) throw new ImageSeedGuardError(`This run would write images to tenant "${slug}". Re-run with --yes to confirm.`);
  return { slug };
}

// --- Destination (D-8E.26-B4.3) --------------------------------------------------------------------------------------------
// "On this machine" does not identify the DEVELOPMENT database: the testing server, the restored copy and other clusters are on this
// machine too, and a restored copy holds the very same tenant ids and slugs. The destination is therefore pinned exactly.
// These constants mirror the documented environments (tools/pg-verify/README.md, env-guard.ts: development = saas_inventory_dev on
// 55432; the dev S3 shim = dev-s3-shim.mjs, default 9000). The development port has no variable of its own (it lives in the
// MIGRATOR_BOOTSTRAP_DATABASE_URL of the git-ignored .env, which cannot be checked statically), so it is fixed here on purpose:
// anything else — 55433, 55440, 55450, 55470, 5432, any unknown port — is refused, and changing it is a code change.
export const DEV_DATABASE_NAME = 'saas_inventory_dev';
export const DEV_DATABASE_PORT = 55432;
export const DEV_S3_PORT = 9000;

/** The only URL parameters tolerated; any other could change what the connection really targets. */
const ALLOWED_DATABASE_PARAMS = new Set(['sslmode', 'ssl', 'connect_timeout', 'application_name']);

export interface DatabaseTarget {
  readonly host: string;
  readonly port: number;
  readonly database: string;
}

/** Parses a connection URL into host/port/database, or refuses. The URL itself is never put in a message. */
export function parseDatabaseTarget(raw: string | undefined, label: string): DatabaseTarget {
  if (raw === undefined || raw.trim() === '') throw new ImageSeedGuardError(`${label} is not set.`);
  // A host list ("a:1,b:2") is ambiguous: the driver would pick among them. Looked for in the raw authority, before URL parsing.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*,/i.test(raw)) throw new ImageSeedGuardError(`${label} lists more than one host; the destination is ambiguous.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageSeedGuardError(`${label} is not a valid URL.`);
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new ImageSeedGuardError(`${label} is not a postgres:// URL.`);
  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) throw new ImageSeedGuardError(`${label}: the host is not on this machine; refusing.`);
  if (url.port === '') throw new ImageSeedGuardError(`${label} has no explicit port; the destination cannot be verified.`);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (database === '' || database.includes('/')) throw new ImageSeedGuardError(`${label} does not name exactly one database.`);
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_DATABASE_PARAMS.has(key.toLowerCase())) {
      throw new ImageSeedGuardError(`${label} carries the URL parameter "${key}", which could change the effective destination; refusing.`);
    }
  }
  return { host: host === 'localhost' ? '127.0.0.1' : host, port: Number(url.port), database };
}

/**
 * Both connections the script really uses — `APP_PLATFORM_DATABASE_URL` (tenant lookup) and `DATABASE_URL` (the app_tenant client that
 * writes) — must be the SAME server and database, and that must be the development database. Anything that cannot be verified is refused.
 */
export function assertDevDatabaseTargets(platformUrl: string | undefined, appUrl: string | undefined): void {
  const platform = parseDatabaseTarget(platformUrl, 'APP_PLATFORM_DATABASE_URL');
  const app = parseDatabaseTarget(appUrl, 'DATABASE_URL');
  if (platform.host !== app.host) throw new ImageSeedGuardError('The two database URLs point at different hosts; refusing.');
  if (platform.port !== app.port) throw new ImageSeedGuardError('The two database URLs point at different ports; refusing.');
  if (platform.database !== app.database) throw new ImageSeedGuardError('The two database URLs name different databases; refusing.');
  if (app.database !== DEV_DATABASE_NAME) throw new ImageSeedGuardError(`The database is not "${DEV_DATABASE_NAME}"; refusing.`);
  if (app.port !== DEV_DATABASE_PORT) {
    throw new ImageSeedGuardError(
      `Port ${String(app.port)} is not the development database port (${String(DEV_DATABASE_PORT)}); the testing server, a restored copy and other local clusters are refused.`,
    );
  }
}

/** `S3_ENDPOINT` must be the local dev S3 shim: loopback, explicit port 9000, no credentials, no path. Checked before any upload. */
export function assertDevS3Endpoint(raw: string | undefined): void {
  if (raw === undefined || raw.trim() === '') throw new ImageSeedGuardError('S3_ENDPOINT is not set.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageSeedGuardError('S3_ENDPOINT is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ImageSeedGuardError('S3_ENDPOINT must be an http(s) URL.');
  if (url.username !== '' || url.password !== '') throw new ImageSeedGuardError('S3_ENDPOINT must not contain credentials.');
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) throw new ImageSeedGuardError('S3_ENDPOINT is not on this machine; refusing to upload.');
  if (url.port === '') throw new ImageSeedGuardError('S3_ENDPOINT has no explicit port; the destination cannot be verified.');
  if (Number(url.port) !== DEV_S3_PORT) {
    throw new ImageSeedGuardError(`S3_ENDPOINT port ${url.port} is not the dev S3 shim port (${String(DEV_S3_PORT)}); refusing to upload.`);
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') {
    throw new ImageSeedGuardError('S3_ENDPOINT must be a bare origin (no path, query or fragment).');
  }
}

/** The tenant row read from the platform table must exist and be active. */
export function assertTenantUsable(row: { id: string; status: string } | undefined, slug: string): { id: string } {
  if (!row) throw new ImageSeedGuardError(`No tenant found with slug "${slug}".`);
  if (row.status !== 'active') throw new ImageSeedGuardError(`Tenant "${slug}" is "${row.status}", not active; refusing.`);
  return { id: row.id };
}

export interface ProductImageState {
  readonly id: string;
  readonly imageCount: number;
}

/** Only a product with no image at all gets one; the others are left exactly as they are. */
export function planImageInserts(products: readonly ProductImageState[]): { toInsert: string[]; skipped: number } {
  const toInsert = products.filter((p) => p.imageCount === 0).map((p) => p.id);
  return { toInsert, skipped: products.length - toInsert.length };
}
