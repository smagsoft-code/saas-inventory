import { deflateSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { getRequiredEnvVar } from '@saas-inventory/config';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { closePostgresClient } from './client';
import { ImageSeedGuardError } from './seed-test-product-images.guard';
import { runImageSeed, type ImageSeedPorts, type ImageSeedTx } from './seed-test-product-images.core';
import { withTenantTransaction } from './tenant-context';

/**
 * OUI-006 — a one-off, throwaway QA seed: uploads a single flat-color placeholder PNG once, then
 * assigns it (the *same* image, per the owner's own "puedes agregar una imagen igual a todos los
 * productos, como prueba" instruction) to every product of ONE allowlisted QA tenant that has no
 * image at all. Never part of `db:migrate`/`db:seed` (the demo pipeline of `packages/database`,
 * ADR-0014) — a manual dev script.
 *
 * It writes DIRECTLY to the database, so (D-8E.26-B4.1) it refuses to run unless, before any
 * connection is opened (see seed-test-product-images.guard.ts, unit-tested):
 *   - SEED_TENANT_SLUG names the tenant explicitly (no default);
 *   - that tenant is on the fixed QA allowlist in the guard (today only `qa-dev-tenant`);
 *     `muebleria-elegante` and every other tenant are rejected, and no variable can extend the list;
 *   - APP_PLATFORM_DATABASE_URL and DATABASE_URL are the SAME server and database, and that is the development
 *     database: `saas_inventory_dev` on port 55432 exactly (a restored copy, the testing server and any other
 *     local cluster are refused; no URL parameter may change the target; multi-host URLs are refused);
 *   - S3_ENDPOINT is the local dev S3 shim (loopback, port 9000, no credentials) — checked before any upload;
 *   - the tenant exists and is active;
 *   - `--yes` is given.
 * A product that already has an image is never touched; if no product needs one, nothing is
 * uploaded and nothing is written, so a repeat run is a no-op.
 *
 * The flow itself lives in seed-test-product-images.core.ts (unit-tested with fake ports); THIS file only wires the real
 * ports: the platform lookup, the tenant-scoped SQL, the S3 client. Those adapters are not covered by unit tests (they
 * need the real services) and have never been run by the automated checks.
 *
 * Usage: `SEED_TENANT_SLUG=qa-dev-tenant pnpm --filter @saas-inventory/api exec tsx src/database/seed-test-product-images.ts --yes`
 * (with the dev `.env` sourced — it needs `APP_PLATFORM_DATABASE_URL` to resolve the tenant by
 * slug and `DATABASE_URL`/`S3_*` for everything after that).
 */

/** Builds a minimal, valid, flat-color PNG by hand — no image library dependency for a one-off
 * dev script. `crc32` is hand-rolled (table-based, standard PNG/zlib polynomial) rather than
 * relying on `zlib.crc32` (Node 20.12+ only) so this runs on whatever Node this repo targets. */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** A flat `#2F6FED` (the app's own primary blue, per the UI-UX-SPEC-001 owner decision) square. */
function buildPlaceholderPng(size = 128): Buffer {
  const [r, g, b] = [0x2f, 0x6f, 0xed];
  const rowBytes = size * 3;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter type: None
    for (let x = 0; x < size; x += 1) {
      const pixelStart = rowStart + 1 + x * 3;
      raw[pixelStart] = r;
      raw[pixelStart + 1] = g;
      raw[pixelStart + 2] = b;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor (RGB)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw);

  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** The platform lookup: `tenants` is platform-scoped (no RLS), read with the app_platform connection. */
async function findTenantBySlug(slug: string): Promise<{ id: string; status: string } | undefined> {
  const platformSql = postgres(getRequiredEnvVar('APP_PLATFORM_DATABASE_URL'), { max: 1 });
  try {
    const rows = await platformSql<{ id: string; status: string }[]>`select id, status from tenants where slug = ${slug} limit 1`;
    return rows[0];
  } finally {
    await platformSql.end();
  }
}

/** The real tenant-scoped SQL (RLS applies: app_tenant with app.tenant_id set by withTenantTransaction). */
const realPorts: ImageSeedPorts = {
  findTenantBySlug,
  withTenantTransaction: <T>(tenantId: string, work: (tx: ImageSeedTx) => Promise<T>): Promise<T> =>
    withTenantTransaction(tenantId, (tx) =>
      work({
        async listProductImageStates(tid) {
          const rows = await tx.execute<{ id: string; image_count: number }>(
            sql`select p.id, (select count(*)::int from product_images i where i.tenant_id = ${tid} and i.product_id = p.id) as image_count
                from products p where p.tenant_id = ${tid} and p.deleted_at is null`,
          );
          return [...rows].map((row) => ({ id: row.id, imageCount: row.image_count }));
        },
        async hasImage(tid, productId) {
          const rows = await tx.execute<{ id: string }>(sql`select id from product_images where tenant_id = ${tid} and product_id = ${productId} limit 1`);
          return rows.length > 0;
        },
        async insertImage(tid, productId, storageKey) {
          await tx.execute(sql`
            insert into product_images (tenant_id, product_id, storage_key, mime_type, position)
            values (${tid}, ${productId}, ${storageKey}, 'image/png', 0)
          `);
        },
      }),
    ),
  putObject: (key, body, contentType) => new ObjectStorageService().putObject(key, body, contentType),
  buildPlaceholder: () => buildPlaceholderPng(),
  log: (line) => console.log(line),
};

async function main(): Promise<void> {
  await runImageSeed({ env: process.env, argv: process.argv.slice(2) }, realPorts);
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof ImageSeedGuardError ? 'Seeding test product images refused:' : 'Seeding test product images failed:',
      error instanceof ImageSeedGuardError ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    // getDb()'s postgres-js pool otherwise keeps its socket open and the process never exits.
    void closePostgresClient();
  });
