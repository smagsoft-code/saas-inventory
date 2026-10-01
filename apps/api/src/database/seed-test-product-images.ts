import { deflateSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { getRequiredEnvVar } from '@saas-inventory/config';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { closePostgresClient } from './client';
import { withTenantTransaction } from './tenant-context';

/**
 * OUI-006 — a one-off, throwaway QA seed: uploads a single flat-color placeholder PNG once, then
 * assigns it (the *same* image, per the owner's own "puedes agregar una imagen igual a todos los
 * productos, como prueba" instruction) to every product in `qa-tenant` that has none yet. Never
 * part of `db:migrate`/`db:seed` (`packages/database`'s own, carefully-scoped demo pipeline,
 * ADR-0014) — this is a manual, run-once dev script, the same convention `bootstrap-dev-roles.ts`
 * already establishes for this kind of thing.
 *
 * Usage: `pnpm --filter @saas-inventory/api exec tsx src/database/seed-test-product-images.ts`
 * (with the dev `.env` sourced — it needs `APP_PLATFORM_DATABASE_URL` to resolve the tenant by
 * slug, same as `AuthService` does before a tenant context exists, and `DATABASE_URL`/`S3_*` for
 * everything after that).
 */
const TENANT_SLUG = process.env['SEED_TENANT_SLUG'] ?? 'qa-tenant';

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

async function resolveTenantId(slug: string): Promise<string> {
  const platformSql = postgres(getRequiredEnvVar('APP_PLATFORM_DATABASE_URL'), { max: 1 });
  try {
    const rows = await platformSql<{ id: string }[]>`select id from tenants where slug = ${slug} limit 1`;
    const tenant = rows[0];
    if (!tenant) {
      throw new Error(`No tenant found with slug "${slug}".`);
    }
    return tenant.id;
  } finally {
    await platformSql.end();
  }
}

async function main(): Promise<void> {
  const tenantId = await resolveTenantId(TENANT_SLUG);
  const objectStorage = new ObjectStorageService();
  const placeholderKey = `products/${tenantId}/_seed/placeholder.png`;
  await objectStorage.putObject(placeholderKey, buildPlaceholderPng(), 'image/png');
  console.log(`Uploaded placeholder image to ${placeholderKey}`);

  const summary = await withTenantTransaction(tenantId, async (tx) => {
    const products = await tx.execute<{ id: string }>(
      sql`select id from products where tenant_id = ${tenantId} and deleted_at is null`,
    );
    let created = 0;
    let skipped = 0;
    for (const product of products) {
      const existing = await tx.execute<{ id: string }>(
        sql`select id from product_images where tenant_id = ${tenantId} and product_id = ${product.id} limit 1`,
      );
      if (existing.length > 0) {
        skipped += 1;
        continue;
      }
      await tx.execute(sql`
        insert into product_images (tenant_id, product_id, storage_key, mime_type, position)
        values (${tenantId}, ${product.id}, ${placeholderKey}, 'image/png', 0)
      `);
      created += 1;
    }
    return { total: products.length, created, skipped };
  });

  console.log(
    `Tenant ${TENANT_SLUG} (${tenantId}): ${summary.total} product(s), ${summary.created} image row(s) created, ${summary.skipped} already had one.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Seeding test product images failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    // getDb()'s postgres-js pool otherwise keeps its socket open and the process never exits.
    void closePostgresClient();
  });
