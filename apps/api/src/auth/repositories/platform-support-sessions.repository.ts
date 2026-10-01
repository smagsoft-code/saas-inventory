import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { PLATFORM_DATABASE } from '../../database/database.module';
import type { PlatformDatabase } from '../../database/platform-client';
import { platformSupportSessions } from '../../database/schema';

export type SupportSessionMode = 'read' | 'write';

export interface SupportSessionRow {
  id: string;
  platformAdminId: string;
  tenantId: string;
  mode: string;
  reason: string;
  status: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
}

/**
 * The one repository touching `platform_support_sessions` (ADR-0036). Platform-scoped (no RLS) —
 * `app_platform` only. This table, not a new cookie/token type, is what `RequireSupportSession()`
 * checks on every support-scoped request — the caller is still authenticated purely by their
 * existing platform access token (`CurrentPlatformAdmin()`); this repository answers "is there
 * currently a live session letting this platform admin act on this tenant, and in which mode."
 */
@Injectable()
export class PlatformSupportSessionsRepository {
  constructor(@Inject(PLATFORM_DATABASE) private readonly platformDb: PlatformDatabase) {}

  /** The DB partial unique index (`platform_support_sessions_admin_active_key`) guarantees at
   * most one `active` row per platform admin — this ends it first (idempotent no-op if there is
   * none), so starting a new session on a different tenant never collides with it instead of
   * erroring (ADR-0036 §17: one live support context per platform admin, enforced by superseding,
   * not by rejecting the new request). */
  async endActiveForAdmin(platformAdminId: string): Promise<SupportSessionRow | undefined> {
    const [row] = await this.platformDb
      .update(platformSupportSessions)
      .set({ status: 'ended', endedAt: new Date() })
      .where(and(eq(platformSupportSessions.platformAdminId, platformAdminId), eq(platformSupportSessions.status, 'active')))
      .returning();
    return row;
  }

  async create(values: {
    id: string;
    platformAdminId: string;
    tenantId: string;
    mode: SupportSessionMode;
    reason: string;
    expiresAt: Date;
  }): Promise<SupportSessionRow> {
    const [row] = await this.platformDb.insert(platformSupportSessions).values({ ...values, status: 'active' }).returning();
    if (!row) {
      throw new Error('Support session insert did not return a row.');
    }
    return row;
  }

  /** The live, still-unexpired `active` session for this platform admin, if any — regardless of
   * tenant (used by `GET .../current` and by the "end current" action, which takes no tenant id).
   * A row that is `active` in storage but past `expires_at` is treated as absent here (never
   * returned as usable) — `markExpiredIfStale` is what actually flips its status, called by the
   * same paths that read this. */
  async findActiveForAdmin(platformAdminId: string): Promise<SupportSessionRow | undefined> {
    const [row] = await this.platformDb
      .select()
      .from(platformSupportSessions)
      .where(
        and(
          eq(platformSupportSessions.platformAdminId, platformAdminId),
          eq(platformSupportSessions.status, 'active'),
          sql`${platformSupportSessions.expiresAt} > now()`,
        ),
      );
    return row;
  }

  /** The guard's core check: is there a live, unexpired session letting `platformAdminId` act on
   * `tenantId`, and in which mode. */
  async findActiveForAdminAndTenant(platformAdminId: string, tenantId: string): Promise<SupportSessionRow | undefined> {
    const [row] = await this.platformDb
      .select()
      .from(platformSupportSessions)
      .where(
        and(
          eq(platformSupportSessions.platformAdminId, platformAdminId),
          eq(platformSupportSessions.tenantId, tenantId),
          eq(platformSupportSessions.status, 'active'),
          sql`${platformSupportSessions.expiresAt} > now()`,
        ),
      );
    return row;
  }

  async end(id: string): Promise<SupportSessionRow | undefined> {
    const [row] = await this.platformDb
      .update(platformSupportSessions)
      .set({ status: 'ended', endedAt: new Date() })
      .where(and(eq(platformSupportSessions.id, id), eq(platformSupportSessions.status, 'active')))
      .returning();
    return row;
  }

  /** Flips a stale `active` row (past `expires_at`) to `expired` — called opportunistically by
   * `GET .../current` and by the guard on a miss, so the stored status converges to reality without
   * needing a cron; never itself the authorization decision (the `expires_at > now()` predicate in
   * the two `findActive*` methods above is). */
  async markExpiredIfStale(platformAdminId: string): Promise<void> {
    await this.platformDb
      .update(platformSupportSessions)
      .set({ status: 'expired' })
      .where(
        and(
          eq(platformSupportSessions.platformAdminId, platformAdminId),
          eq(platformSupportSessions.status, 'active'),
          sql`${platformSupportSessions.expiresAt} <= now()`,
        ),
      );
  }
}
