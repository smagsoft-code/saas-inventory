import { describe, expect, it } from 'vitest';
import { runImageSeed, type ImageSeedPorts, type ImageSeedTx } from './seed-test-product-images.core';
import { ImageSeedGuardError } from './seed-test-product-images.guard';

/**
 * These tests exercise the REAL `runImageSeed` against fake ports: an in-memory tenant, its products and images, and an in-memory
 * object store. No PostgreSQL, no S3, no network. The fake transaction models the rollback that the real `withTenantTransaction`
 * (a drizzle `db.transaction`) provides: if the callback throws, every change it made is undone. That rollback is the database's
 * behaviour, not something these tests prove about PostgreSQL.
 */

const GOOD_ENV = {
  SEED_TENANT_SLUG: 'qa-dev-tenant',
  APP_PLATFORM_DATABASE_URL: 'postgresql://app_platform:pw@127.0.0.1:55432/saas_inventory_dev',
  DATABASE_URL: 'postgresql://app_tenant:pw@127.0.0.1:55432/saas_inventory_dev',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
};
const ARGS = ['--yes'];

interface FakeProduct {
  id: string;
  images: string[];
}

class FakeImageWorld {
  tenant: { id: string; status: string } | undefined = { id: 'tenant-1', status: 'active' };
  products: FakeProduct[] = [];
  objects = new Map<string, number>();
  /** Everything that touched a port, in order. */
  trace: string[] = [];
  uploads = 0;
  inserts = 0;
  rollbacks = 0;
  commits = 0;
  failList = false;
  failUpload = false;
  /** Throw while inserting the n-th row (1-based) of the write transaction. */
  failInsertAt: number | undefined;
  /** Called at the start of the SECOND transaction (the write one): models another process inserting an image first. */
  beforeWrite: (() => void) | undefined;
  private txCount = 0;
  logs: string[] = [];

  ports(): ImageSeedPorts {
    return {
      findTenantBySlug: (slug) => {
        this.trace.push(`findTenant:${slug}`);
        return Promise.resolve(this.tenant);
      },
      withTenantTransaction: async <T>(_tenantId: string, work: (tx: ImageSeedTx) => Promise<T>): Promise<T> => {
        this.trace.push('tx:begin');
        this.txCount += 1;
        if (this.txCount === 2) this.beforeWrite?.();
        const snapshot = this.products.map((p) => ({ id: p.id, images: [...p.images] }));
        const insertsBefore = this.inserts;
        let insertsInThisTx = 0;
        const tx: ImageSeedTx = {
          listProductImageStates: () => {
            if (this.failList) return Promise.reject(new Error('injected: listing failed'));
            return Promise.resolve(this.products.map((p) => ({ id: p.id, imageCount: p.images.length })));
          },
          hasImage: (_t, productId) => Promise.resolve((this.products.find((p) => p.id === productId)?.images.length ?? 0) > 0),
          insertImage: (_t, productId, storageKey) => {
            insertsInThisTx += 1;
            if (this.failInsertAt === insertsInThisTx) return Promise.reject(new Error('injected: insert failed'));
            this.products.find((p) => p.id === productId)?.images.push(storageKey);
            this.inserts += 1;
            return Promise.resolve();
          },
        };
        try {
          const result = await work(tx);
          this.commits += 1;
          this.trace.push('tx:commit');
          return result;
        } catch (error) {
          this.products = snapshot; // rollback
          this.inserts = insertsBefore;
          this.rollbacks += 1;
          this.trace.push('tx:rollback');
          throw error;
        }
      },
      putObject: (key) => {
        this.trace.push(`putObject:${key}`);
        if (this.failUpload) return Promise.reject(new Error('injected: upload failed'));
        this.uploads += 1;
        this.objects.set(key, (this.objects.get(key) ?? 0) + 1);
        return Promise.resolve();
      },
      buildPlaceholder: () => Buffer.from('png'),
      log: (line) => this.logs.push(line),
    };
  }

  totalImages(): number {
    return this.products.reduce((n, p) => n + p.images.length, 0);
  }
  touchedAnyPort(): boolean {
    return this.trace.length > 0;
  }
}

const world = (products: FakeProduct[]): FakeImageWorld => {
  const w = new FakeImageWorld();
  w.products = products;
  return w;
};
const run = (w: FakeImageWorld, env: Record<string, string | undefined> = GOOD_ENV, argv: string[] = ARGS) => runImageSeed({ env, argv }, w.ports());

describe('runImageSeed — the flow, against fake ports', () => {
  it('1. no product needs an image: nothing is uploaded and nothing is inserted', async () => {
    const w = world([{ id: 'p1', images: ['k1'] }, { id: 'p2', images: ['k2', 'k3'] }]);
    const summary = await run(w);
    expect(summary).toEqual({ total: 2, created: 0, skipped: 2, uploaded: false });
    expect(w.uploads).toBe(0);
    expect(w.inserts).toBe(0);
    expect(w.trace).not.toContain('tx:rollback');
    expect(w.trace.filter((t) => t.startsWith('putObject'))).toEqual([]);
  });

  it('2. one product needs an image: exactly one upload and exactly one insertion, for that product only', async () => {
    const w = world([{ id: 'p1', images: ['k1'] }, { id: 'p2', images: [] }, { id: 'p3', images: ['k3'] }]);
    const summary = await run(w);
    expect(summary).toEqual({ total: 3, created: 1, skipped: 2, uploaded: true });
    expect(w.uploads).toBe(1);
    expect(w.inserts).toBe(1);
    expect(w.products.find((p) => p.id === 'p2')?.images).toEqual(['products/tenant-1/_seed/placeholder.png']);
    expect(w.products.find((p) => p.id === 'p1')?.images).toEqual(['k1']);
    expect(w.products.find((p) => p.id === 'p3')?.images).toEqual(['k3']);
  });

  it('3. a product that already has an image is never given a second one', async () => {
    const w = world([{ id: 'p1', images: ['own.png'] }]);
    await run(w);
    expect(w.products[0]?.images).toEqual(['own.png']);
    expect(w.inserts).toBe(0);
  });

  it('4. the second check inside the write transaction: if another process inserted an image meanwhile, none is added', async () => {
    const w = world([{ id: 'p1', images: [] }, { id: 'p2', images: [] }]);
    w.beforeWrite = () => w.products.find((p) => p.id === 'p1')?.images.push('concurrent.png');
    const summary = await run(w);
    expect(w.products.find((p) => p.id === 'p1')?.images).toEqual(['concurrent.png']);
    expect(w.products.find((p) => p.id === 'p2')?.images).toHaveLength(1);
    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(1);
  });

  it('5. an error before inserting leaves no rows (a failing read pass uploads and writes nothing)', async () => {
    const w = world([{ id: 'p1', images: [] }]);
    w.failList = true;
    await expect(run(w)).rejects.toThrow(/listing failed/);
    expect(w.uploads).toBe(0);
    expect(w.inserts).toBe(0);
    expect(w.totalImages()).toBe(0);
  });

  it('6. an error during the write transaction rolls it back: the rows inserted before the failure are undone', async () => {
    const w = world([{ id: 'p1', images: [] }, { id: 'p2', images: [] }, { id: 'p3', images: [] }]);
    w.failInsertAt = 2; // the second insert fails after the first succeeded
    await expect(run(w)).rejects.toThrow(/insert failed/);
    expect(w.rollbacks).toBe(1);
    expect(w.totalImages()).toBe(0); // the first insert was rolled back too
    expect(w.trace.at(-1)).toBe('tx:rollback');
    // the placeholder object stays in the bucket (documented limit) but no row refers to it
    expect(w.uploads).toBe(1);
  });

  it('7. a failed upload leaves no image row: the upload happens before any write', async () => {
    const w = world([{ id: 'p1', images: [] }, { id: 'p2', images: [] }]);
    w.failUpload = true;
    await expect(run(w)).rejects.toThrow(/upload failed/);
    expect(w.inserts).toBe(0);
    expect(w.totalImages()).toBe(0);
    // only the read transaction ran: the write transaction was never opened
    expect(w.trace.filter((t) => t === 'tx:begin')).toHaveLength(1);
    const upload = w.trace.findIndex((t) => t.startsWith('putObject'));
    expect(w.trace.slice(upload)).not.toContain('tx:begin');
  });

  it('10. two consecutive runs do not duplicate images: the second uploads and writes nothing', async () => {
    const w = world([{ id: 'p1', images: [] }, { id: 'p2', images: ['mine.png'] }, { id: 'p3', images: [] }]);
    const first = await run(w);
    expect(first.created).toBe(2);
    const imagesAfterFirst = w.totalImages();
    const uploadsAfterFirst = w.uploads;
    const second = await run(w);
    expect(second).toEqual({ total: 3, created: 0, skipped: 3, uploaded: false });
    expect(w.totalImages()).toBe(imagesAfterFirst);
    expect(w.uploads).toBe(uploadsAfterFirst);
    expect(w.products.every((p) => p.images.length === 1)).toBe(true);
  });

  it('uploads before the write transaction begins (order pinned)', async () => {
    const w = world([{ id: 'p1', images: [] }]);
    await run(w);
    expect(w.trace).toEqual([
      'findTenant:qa-dev-tenant',
      'tx:begin',
      'tx:commit',
      'putObject:products/tenant-1/_seed/placeholder.png',
      'tx:begin',
      'tx:commit',
    ]);
  });
});

describe('runImageSeed — a refused configuration touches nothing', () => {
  const products = (): FakeProduct[] => [{ id: 'p1', images: [] }];

  it('8. a wrong PostgreSQL destination: zero lookups, zero transactions, zero uploads, zero writes', async () => {
    const wrongs: Array<Record<string, string>> = [
      { ...GOOD_ENV, DATABASE_URL: 'postgresql://app_tenant:pw@127.0.0.1:55470/saas_inventory_dev', APP_PLATFORM_DATABASE_URL: 'postgresql://app_platform:pw@127.0.0.1:55470/saas_inventory_dev' }, // restore-test
      { ...GOOD_ENV, DATABASE_URL: 'postgresql://app_tenant:pw@127.0.0.1:55450/saas_inventory_verify', APP_PLATFORM_DATABASE_URL: 'postgresql://app_platform:pw@127.0.0.1:55450/saas_inventory_verify' }, // testing
      { ...GOOD_ENV, DATABASE_URL: 'postgresql://app_tenant:pw@127.0.0.1:55433/saas_inventory_dev', APP_PLATFORM_DATABASE_URL: 'postgresql://app_platform:pw@127.0.0.1:55433/saas_inventory_dev' }, // other cluster
      { ...GOOD_ENV, APP_PLATFORM_DATABASE_URL: 'postgresql://app_platform:pw@127.0.0.1:55432/saas_inventory_dev', DATABASE_URL: 'postgresql://app_tenant:pw@127.0.0.1:55470/saas_inventory_dev' }, // split servers
      { ...GOOD_ENV, DATABASE_URL: 'postgresql://app_tenant:pw@db.prod.example:55432/saas_inventory_dev' },
      { ...GOOD_ENV, DATABASE_URL: 'postgresql://app_tenant:pw@127.0.0.1:55432/saas_inventory_dev?host=remote.example' },
    ];
    for (const env of wrongs) {
      const w = world(products());
      await expect(run(w, env)).rejects.toBeInstanceOf(ImageSeedGuardError);
      expect(w.touchedAnyPort()).toBe(false);
      expect(w.uploads).toBe(0);
      expect(w.inserts).toBe(0);
    }
  });

  it('9. a wrong S3 destination: zero uploads and zero writes, and the database is not even queried', async () => {
    for (const endpoint of ['https://s3.amazonaws.com', 'http://127.0.0.1:9100', 'http://minio:9000', 'http://key:secret@127.0.0.1:9000', undefined]) {
      const w = world(products());
      await expect(run(w, { ...GOOD_ENV, S3_ENDPOINT: endpoint })).rejects.toBeInstanceOf(ImageSeedGuardError);
      expect(w.touchedAnyPort()).toBe(false);
      expect(w.uploads).toBe(0);
      expect(w.inserts).toBe(0);
    }
  });

  it('a tenant outside the allowlist, muebleria-elegante, a missing --yes: zero port calls', async () => {
    for (const [env, argv] of [
      [{ ...GOOD_ENV, SEED_TENANT_SLUG: 'muebleria-elegante' }, ARGS],
      [{ ...GOOD_ENV, SEED_TENANT_SLUG: 'qa-dev-tenant-3d3920' }, ARGS],
      [{ ...GOOD_ENV, SEED_TENANT_SLUG: undefined }, ARGS],
      [GOOD_ENV, []],
    ] as const) {
      const w = world(products());
      await expect(run(w, { ...env }, [...argv])).rejects.toBeInstanceOf(ImageSeedGuardError);
      expect(w.touchedAnyPort()).toBe(false);
    }
  });

  it('a suspended or missing tenant stops after the lookup: nothing is read, uploaded or written', async () => {
    const suspended = world(products());
    suspended.tenant = { id: 'tenant-1', status: 'suspended' };
    await expect(run(suspended)).rejects.toThrow(/not active/);
    expect(suspended.trace).toEqual(['findTenant:qa-dev-tenant']);
    const missing = world(products());
    missing.tenant = undefined;
    await expect(run(missing)).rejects.toThrow(/No tenant found/);
    expect(missing.uploads + missing.inserts).toBe(0);
  });
});
