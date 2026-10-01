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

  /** ADR-0036 (Tenant Onboarding), step 1 of 2 — the SuperAdmin-initiated counterpart to
   * `provisionMembership` above, for the one case that method cannot express: no password is
   * supplied yet (the person sets their own via an invitation). A NEW identity is created
   * `pending_credential`/NULL credential (`IdentitiesRepository.findOrCreatePending`); an EXISTING
   * identity is returned as-is, whatever its status — this method never overwrites a credential,
   * same invariant as `provisionMembership`.
   *
   * Deliberately does NOT create the membership itself (unlike `provisionMembership`) — the
   * caller MUST inspect the returned `status` first and decide, per ADR-0036 §4: `'active'` → the
   * identity already has a working credential; create the membership via `linkMembership` below,
   * no invitation needed. `'pending_credential'` → create the membership, then an invitation (new
   * or reused) is how this person will ever set a credential. `'disabled'` → refuse and compensate
   * the tenant/user already created — never call `linkMembership`, never silently provision an
   * unreachable admin (this is exactly the risk the pre-implementation audit flagged as
   * unmitigated in the existing `/auth/register` and `POST /users` paths; this method surfaces it
   * instead of hiding it, but does not itself fix those two pre-existing callers — out of this
   * block's scope). */
  async resolveOrCreatePendingIdentity(email: string, fullName: string): Promise<{ identityId: string; status: string }> {
    const identity = await this.identitiesRepository.findOrCreatePending({
      id: generateId(),
      email: normalizeEmail(email),
      fullName,
    });
    return { identityId: identity.id, status: identity.status };
  }

  /** ADR-0036, step 2 of 2 — creates the `active` membership row once the caller has confirmed the
   * identity (from `resolveOrCreatePendingIdentity`) is usable. Membership is `active` immediately
   * regardless of the identity's own status (unchanged from `provisionMembership`) — a
   * `pending_credential` identity's `status` alone is what blocks login
   * (`AuthService.login` already rejects on it), so there is no second "pending membership" state
   * to invent (§6 of the prompt: "evitando duplicarlos innecesariamente entre Invitation,
   * Membership y Credential"). */
  async linkMembership(input: { tenantId: string; userId: string; identityId: string }): Promise<void> {
    await this.tenantMembershipsRepository.create({
      id: generateId(),
      identityId: input.identityId,
      tenantId: input.tenantId,
      userId: input.userId,
    });
  }
}
