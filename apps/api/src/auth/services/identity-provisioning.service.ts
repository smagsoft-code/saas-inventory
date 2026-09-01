import { Injectable } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { IdentitiesRepository } from '../repositories/identities.repository';
import { TenantMembershipsRepository } from '../repositories/tenant-memberships.repository';
import { normalizeEmail } from '../util/normalize';

export interface ProvisionMembershipInput {
  tenantId: string;
  /** The already-created `users.id` (the tenant-scoped profile row). */
  userId: string;
  /** Raw email — normalized here (the one strategy, `normalizeEmail`). */
  email: string;
  /** Argon2id hash of the caller-supplied password. Used ONLY when the identity is new — an
   * existing identity keeps its own global credential (find-or-create, never overwrite). */
  passwordHash: string;
  /** Display name used only when the identity is new. */
  fullName: string;
}

/**
 * Links a freshly-created tenant-scoped `users` row into the global identity model (016-C /
 * ADR-0033): find-or-create the `identities` row for its (normalized) email, then create the
 * `tenant_memberships` row `(identity_id, tenant_id, user_id, 'active')`.
 *
 * Called by both self-service registration (`TenantProvisioningService`, for the first admin) and
 * tenant-user administration (`UsersService.create`) so every path that produces a `users` row
 * produces a usable identity + membership — a `users` row with no membership is unreachable by
 * the new email+password login.
 *
 * All work is on the `app_platform` connection (both tables are platform-scoped, no RLS). Runs
 * *after* the `users` row is committed — not in its transaction (the two connections cannot share
 * one), same non-atomic seam `TenantProvisioningService` already accepts between the platform
 * `tenants` insert and the tenant-scoped provisioning. The caller compensates on failure.
 */
@Injectable()
export class IdentityProvisioningService {
  constructor(
    private readonly identitiesRepository: IdentitiesRepository,
    private readonly tenantMembershipsRepository: TenantMembershipsRepository,
  ) {}

  async provisionMembership(input: ProvisionMembershipInput): Promise<{ identityId: string }> {
    const email = normalizeEmail(input.email);
    const identity = await this.identitiesRepository.findOrCreate({
      id: generateId(),
      email,
      passwordHash: input.passwordHash,
      fullName: input.fullName,
    });
    await this.tenantMembershipsRepository.create({
      id: generateId(),
      identityId: identity.id,
      tenantId: input.tenantId,
      userId: input.userId,
    });
    return { identityId: identity.id };
  }
}
