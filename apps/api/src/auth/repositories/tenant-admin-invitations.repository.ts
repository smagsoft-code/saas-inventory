import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { PLATFORM_DATABASE } from '../../database/database.module';
import type { PlatformDatabase } from '../../database/platform-client';
import { tenantAdminInvitations } from '../../database/schema';

export interface InvitationRow {
  id: string;
  tenantId: string;
  identityId: string;
  userId: string;
  tokenHash: string;
  status: string;
  createdBy: string | null;
  sentAt: Date | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const LIVE_STATUSES = ['pending', 'sent'] as const;

/**
 * The one repository touching `tenant_admin_invitations` (ADR-0036). Platform-scoped (no RLS, no
 * `app_tenant` grant) — every method runs on the `app_platform` connection, same posture as
 * `IdentitiesRepository`/`TenantMembershipsRepository`. Never returns `tokenHash` to a caller that
 * would put it in an HTTP response — callers select it explicitly only when they need to compare
 * against an incoming raw token's hash (`findByTokenHash`).
 */
@Injectable()
export class TenantAdminInvitationsRepository {
  constructor(@Inject(PLATFORM_DATABASE) private readonly platformDb: PlatformDatabase) {}

  async create(values: {
    id: string;
    tenantId: string;
    identityId: string;
    userId: string;
    tokenHash: string;
    createdBy: string;
    expiresAt: Date;
  }): Promise<InvitationRow> {
    const [row] = await this.platformDb
      .insert(tenantAdminInvitations)
      .values({ ...values, status: 'sent', sentAt: new Date() })
      .returning();
    if (!row) {
      throw new Error('Invitation insert did not return a row.');
    }
    return row;
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationRow | undefined> {
    const [row] = await this.platformDb.select().from(tenantAdminInvitations).where(eq(tenantAdminInvitations.tokenHash, tokenHash));
    return row;
  }

  async findById(id: string): Promise<InvitationRow | undefined> {
    const [row] = await this.platformDb.select().from(tenantAdminInvitations).where(eq(tenantAdminInvitations.id, id));
    return row;
  }

  /** Most recent invitation for a tenant, of any status — backs the SuperAdmin tenant-detail
   * "estado de invitación" panel (ADR-0036 §6), scoped to the tenant's founding admin since this
   * feature only ever provisions one invitation-eligible user per tenant today. */
  async findLatestForTenant(tenantId: string): Promise<InvitationRow | undefined> {
    const [row] = await this.platformDb
      .select()
      .from(tenantAdminInvitations)
      .where(eq(tenantAdminInvitations.tenantId, tenantId))
      .orderBy(desc(tenantAdminInvitations.createdAt))
      .limit(1);
    return row;
  }

  /** The at-most-one live (`pending`/`sent`) invitation for a user, if any — what "resend"
   * supersedes and what "revoke" targets. Relies on the same live-status set the partial unique
   * index (`tenant_admin_invitations_user_live_key`) enforces at the DB level. */
  async findLiveForUser(userId: string): Promise<InvitationRow | undefined> {
    const [row] = await this.platformDb
      .select()
      .from(tenantAdminInvitations)
      .where(and(eq(tenantAdminInvitations.userId, userId), inArray(tenantAdminInvitations.status, [...LIVE_STATUSES])));
    return row;
  }

  /** Marks a live invitation `revoked` — used both by explicit revoke and by "resend" (supersede,
   * never leave two valid tokens outstanding — §5 of the prompt). No-op (returns `undefined`) if
   * the row is no longer live, so a double-click never errors. */
  async revoke(id: string): Promise<InvitationRow | undefined> {
    const [row] = await this.platformDb
      .update(tenantAdminInvitations)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(sql`${tenantAdminInvitations.id} = ${id} AND ${tenantAdminInvitations.status} IN ('pending', 'sent')`)
      .returning();
    return row;
  }

  /** CAS: accepts only a still-live, not-yet-expired invitation. The caller (the accept-invitation
   * service) checks expiry itself before calling this so it can return a specific "expired" error
   * rather than the generic "not found" this WHERE clause alone would produce — this method is the
   * final, authoritative guard against a race (two accept attempts for the same token). */
  async accept(id: string): Promise<InvitationRow | undefined> {
    const [row] = await this.platformDb
      .update(tenantAdminInvitations)
      .set({ status: 'accepted', acceptedAt: new Date() })
      .where(sql`${tenantAdminInvitations.id} = ${id} AND ${tenantAdminInvitations.status} IN ('pending', 'sent') AND ${tenantAdminInvitations.expiresAt} > now()`)
      .returning();
    return row;
  }
}
