import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { PLATFORM_DATABASE } from '../../database/database.module';
import type { PlatformDatabase } from '../../database/platform-client';
import { identities, tenantMemberships, tenants, users } from '../../database/schema';

/** A membership the caller is allowed to operate through — every status (membership, tenant,
 * identity, user) has already been confirmed `active` by the query that produced it. */
export interface ActiveMembership {
  membershipId: string;
  identityId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  userId: string;
}

/**
 * The one repository touching `tenant_memberships` (016-B / ADR-0033). Platform-scoped (no RLS, no
 * `app_tenant` grant) → `app_platform` connection only, same posture as `TenantsPlatformRepository`.
 *
 * Every read here folds together the *four* status checks the new auth model needs on every
 * membership-scoped decision — `tenant_memberships.status`, `tenants.status`, `identities.status`,
 * `users.status` (+ `users.deleted_at`) — into one JOINed query, so a login, a tenant selection,
 * a refresh and every TenantGuard request each cost exactly one `app_platform` round trip, and a
 * membership / identity / tenant / user disabled after the JWT was issued stops working
 * immediately (the live-check requirement, ADR-0033 §Seguridad — same principle PROMPT 011-A/011-B
 * already applied to tenant/user status, now extended to identity + membership).
 */
@Injectable()
export class TenantMembershipsRepository {
  constructor(@Inject(PLATFORM_DATABASE) private readonly platformDb: PlatformDatabase) {}

  private readonly activeRow = {
    membershipId: tenantMemberships.id,
    identityId: tenantMemberships.identityId,
    tenantId: tenantMemberships.tenantId,
    tenantName: tenants.name,
    tenantSlug: tenants.slug,
    userId: tenantMemberships.userId,
  } as const;

  private activeJoin() {
    return this.platformDb
      .select(this.activeRow)
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .innerJoin(identities, eq(identities.id, tenantMemberships.identityId))
      .innerJoin(users, and(eq(users.id, tenantMemberships.userId), eq(users.tenantId, tenantMemberships.tenantId)));
  }

  private readonly allActive = and(
    eq(tenantMemberships.status, 'active'),
    eq(tenants.status, 'active'),
    eq(identities.status, 'active'),
    eq(users.status, 'active'),
    isNull(users.deletedAt),
  );

  /** Every fully-active membership for an identity — the login step that decides "one company →
   * direct, several → selection". Ordered by tenant name for a stable selection list. */
  async listActiveForIdentity(identityId: string): Promise<ActiveMembership[]> {
    return this.activeJoin()
      .where(and(eq(tenantMemberships.identityId, identityId), this.allActive))
      .orderBy(tenants.name);
  }

  /** Resolve one specific `(identity, tenant)` membership, all four statuses active — used by
   * `/auth/select-tenant` (never trusting the client's `tenantId` beyond this check) and by
   * TenantGuard on every request. */
  async findActiveForIdentityAndTenant(identityId: string, tenantId: string): Promise<ActiveMembership | undefined> {
    const [row] = await this.activeJoin().where(
      and(eq(tenantMemberships.identityId, identityId), eq(tenantMemberships.tenantId, tenantId), this.allActive),
    );
    return row;
  }

  /** Resolve the membership by `(tenant, user)` (`tenant_memberships_user_id_key` makes it unique),
   * all four statuses active — used on refresh, where the opaque refresh-token row carries
   * `tenant_id`/`user_id` but no identity. */
  async findActiveForTenantAndUser(tenantId: string, userId: string): Promise<ActiveMembership | undefined> {
    const [row] = await this.activeJoin().where(
      and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId), this.allActive),
    );
    return row;
  }

  async create(values: { id: string; identityId: string; tenantId: string; userId: string }): Promise<void> {
    await this.platformDb.insert(tenantMemberships).values({ ...values, status: 'active' });
  }
}
