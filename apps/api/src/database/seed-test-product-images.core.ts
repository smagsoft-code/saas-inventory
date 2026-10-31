import {
  assertDevDatabaseTargets,
  assertDevS3Endpoint,
  assertTenantUsable,
  parseImageSeedArgs,
  planImageInserts,
  resolveImageSeedTarget,
  type ProductImageState,
} from './seed-test-product-images.guard';

/**
 * The flow of `seed-test-product-images.ts` (D-8E.26-B4.3, M4), behind injected ports so it can be exercised without PostgreSQL or S3.
 * The script itself is a thin adapter: it builds the real ports (drizzle SQL, the S3 client, the platform lookup) and calls `runImageSeed`.
 *
 * Order, which is what the tests pin:
 *   1. configuration is validated — tenant, allowlist, `--yes`, the exact development database, the dev S3 endpoint — before ANY port is used;
 *   2. the tenant is looked up and must be active;
 *   3. a read-only transaction lists the products and how many images each has;
 *   4. if no product needs an image the run ends: nothing is uploaded and nothing is written;
 *   5. the placeholder is uploaded to S3 BEFORE any database write, so a failed upload leaves no image row pointing at a missing object;
 *   6. one write transaction re-checks each candidate and inserts the missing rows. If it throws, the transaction rolls back (the real
 *      \`withTenantTransaction\` is a drizzle \`db.transaction\`).
 *
 * Known limit: the S3 upload is not part of the database transaction. If the write transaction fails after the upload, the placeholder
 * object stays in the bucket (harmless: same key every time, overwritten by the next run) and no database row refers to it.
 */

export interface ImageSeedTx {
  /** Every live product of the tenant with the number of images it has. */
  listProductImageStates(tenantId: string): Promise<ProductImageState[]>;
  hasImage(tenantId: string, productId: string): Promise<boolean>;
  insertImage(tenantId: string, productId: string, storageKey: string): Promise<void>;
}

export interface ImageSeedPorts {
  findTenantBySlug(slug: string): Promise<{ id: string; status: string } | undefined>;
  /** Runs `work` in one tenant-scoped transaction; a throw rolls everything the callback did back. */
  withTenantTransaction<T>(tenantId: string, work: (tx: ImageSeedTx) => Promise<T>): Promise<T>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  buildPlaceholder(): Buffer;
  log(line: string): void;
}

export interface ImageSeedInput {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly argv: readonly string[];
}

export interface ImageSeedSummary {
  readonly total: number;
  readonly created: number;
  readonly skipped: number;
  readonly uploaded: boolean;
}

export async function runImageSeed(input: ImageSeedInput, ports: ImageSeedPorts): Promise<ImageSeedSummary> {
  // 1. Everything that can refuse runs before the first port call (no lookup, no connection, no upload).
  const { slug } = resolveImageSeedTarget(input.env, parseImageSeedArgs(input.argv));
  assertDevDatabaseTargets(input.env['APP_PLATFORM_DATABASE_URL'], input.env['DATABASE_URL']);
  assertDevS3Endpoint(input.env['S3_ENDPOINT']);

  // 2. The tenant.
  const tenant = assertTenantUsable(await ports.findTenantBySlug(slug), slug);

  // 3. Read-only pass.
  const states = await ports.withTenantTransaction(tenant.id, (tx) => tx.listProductImageStates(tenant.id));
  const plan = planImageInserts(states);

  // 4. Nothing to do.
  if (plan.toInsert.length === 0) {
    ports.log(`Tenant ${slug}: ${String(states.length)} product(s), all already have an image. Nothing uploaded, nothing written.`);
    return { total: states.length, created: 0, skipped: plan.skipped, uploaded: false };
  }

  // 5. Upload first.
  const placeholderKey = `products/${tenant.id}/_seed/placeholder.png`;
  await ports.putObject(placeholderKey, ports.buildPlaceholder(), 'image/png');
  ports.log(`Uploaded placeholder image to ${placeholderKey}`);

  // 6. One write transaction, re-checking each candidate.
  const summary = await ports.withTenantTransaction(tenant.id, async (tx) => {
    let created = 0;
    let skipped = plan.skipped;
    for (const productId of plan.toInsert) {
      if (await tx.hasImage(tenant.id, productId)) {
        skipped += 1; // gained an image since the read pass: left alone
        continue;
      }
      await tx.insertImage(tenant.id, productId, placeholderKey);
      created += 1;
    }
    return { total: states.length, created, skipped, uploaded: true };
  });
  ports.log(`Tenant ${slug} (${tenant.id}): ${String(summary.total)} product(s), ${String(summary.created)} image row(s) created, ${String(summary.skipped)} already had one.`);
  return summary;
}
