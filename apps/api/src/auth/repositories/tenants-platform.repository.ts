import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PLATFORM_DATABASE } from '../../database/database.module';
import type { PlatformDatabase } from '../../database/platform-client';
import { tenants } from '../../database/schema';

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
}

/**
 * The one place self-service registration touches the platform-scoped `tenants` table — via the
 * app_platform connection (the only role granted access to it; app_tenant has none, migration
 * 0001). Every method here is deliberately narrow and explicit, per
 * multi-tenancy.md#administrative--cross-tenant-queries — never a general substitute for the
 * tenant-scoped repositories.
 */
@Injectable()
export class TenantsPlatformRepository {
  constructor(@Inject(PLATFORM_DATABASE) private readonly platformDb: PlatformDatabase) {}

  async findBySlug(slug: string): Promise<TenantRow | undefined> {
    const [row] = await this.platformDb.select().from(tenants).where(eq(tenants.slug, slug));
    return row;
  }

  async findById(id: string): Promise<TenantRow | undefined> {
    const [row] = await this.platformDb.select().from(tenants).where(eq(tenants.id, id));
    return row;
  }

  async create(values: { id: string; name: string; slug: string }): Promise<void> {
    await this.platformDb.insert(tenants).values({ ...values, status: 'active', isDemo: false });
  }

  /** Best-effort cleanup if tenant-scoped provisioning fails right after the tenant row is
   * created (auth.service.ts) — there is no hard-delete for tenants (database.md's soft-delete
   * policy), so an orphaned registration is marked suspended rather than left silently 'active'
   * with no admin user able to log into it. */
  async markSuspended(tenantId: string): Promise<void> {
    await this.platformDb.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, tenantId));
  }

  /** Derives a URL-safe slug candidate from a company name, then finds an available variant by
   * appending a short random suffix on collision (bounded — this is not expected to loop more
   * than once or twice in practice). */
  async reserveSlug(companyName: string): Promise<string> {
    const base = slugify(companyName);
    let candidate = base;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await this.findBySlug(candidate);
      if (!existing) {
        return candidate;
      }
      candidate = `${base}-${randomBytes(3).toString('hex')}`;
    }
    throw new Error(`Could not reserve a unique tenant slug derived from "${companyName}".`);
  }
}

function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || `tenant-${randomBytes(3).toString('hex')}`;
}
