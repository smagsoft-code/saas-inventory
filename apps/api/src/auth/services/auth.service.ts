import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { generateId } from '@saas-inventory/shared';
import { TenantSettingsRepository } from '../../administration/tenant-settings/tenant-settings.repository';
import { DEFAULT_TIMEZONE } from '../../administration/tenant-settings/tenant-settings.service';
import { AUTH_CONFIG, type AuthConfig } from '../../common/config/auth-config';
import { isSelectionTokenPayload, type SelectionTokenPayload } from '../../common/tokens/access-token-payload';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { CsrfTokenService } from '../csrf/csrf-token.service';
import { PasswordService } from '../password/password.service';
import { IdentitiesRepository } from '../repositories/identities.repository';
import { RefreshTokensPlatformRepository } from '../repositories/refresh-tokens-platform.repository';
import { RefreshTokensRepository } from '../repositories/refresh-tokens.repository';
import { RolesRepository } from '../repositories/roles.repository';
import { TenantMembershipsRepository, type ActiveMembership } from '../repositories/tenant-memberships.repository';
import { UsersRepository } from '../repositories/users.repository';
import { AccessTokenService } from '../tokens/access-token.service';
import { RefreshTokenService } from '../tokens/refresh-token.service';
import { IdentityProvisioningService } from './identity-provisioning.service';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { normalizeEmail } from '../util/normalize';

/** A fixed, valid Argon2id hash of a value nobody can log in with — verified against on a
 * nonexistent-identity login attempt so that path costs roughly the same time as a real password
 * check, closing the timing side-channel that would otherwise let a caller distinguish
 * "no such account" from "wrong password" by response latency (security.md §6). */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$Wk+k4Aqt+cNKE8Icr0KpWA$5llxil2sQA4Rx7RKjXDW2hQ/6E+CEGDr2eypUF2nc4Q';

export interface SessionRequestMeta {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export interface AuthenticatedUserView {
  id: string;
  identityId: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  fullName: string;
  status: string;
  permissions: string[];
  /** The active tenant's IANA timezone (`tenant_settings.timezone`, `'UTC'` when no row exists yet
   * — F18-01, closes `GAP-TZ-VISIBILITY`: every session-issuing response now carries this, not just
   * `GET /administration/tenant-settings` (which stays gated on `administration.settings.view`). */
  timezone: string;
}

export interface IssuedSession {
  kind: 'session';
  accessToken: string;
  accessTokenTtlSeconds: number;
  refreshToken: string;
  refreshTokenTtlSeconds: number;
  csrfToken: string;
  user: AuthenticatedUserView;
}

export interface TenantSelectionRequired {
  kind: 'tenant-selection';
  selectionToken: string;
  selectionTokenTtlSeconds: number;
  availableTenants: { tenantId: string; name: string }[];
}

export interface RegisterInput {
  companyName: string;
  email: string;
  password: string;
  fullName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

function invalidCredentials(): UnauthorizedException {
  // One identical message regardless of which part was wrong — unknown email, wrong password,
  // disabled/pending_credential identity, or an identity with no active membership anywhere
  // (security.md §6, §22). Never reveals account existence, company count or company names.
  return new UnauthorizedException('Invalid email or password.');
}

function invalidSelection(): UnauthorizedException {
  // One message for every selection failure: token missing/expired/wrong-purpose, identity now
  // disabled, or the chosen tenant not being an active membership of this identity.
  return new UnauthorizedException('Invalid or expired selection.');
}

function invalidSession(): UnauthorizedException {
  return new UnauthorizedException('Invalid or expired session.');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly tenantProvisioningService: TenantProvisioningService,
    private readonly identityProvisioningService: IdentityProvisioningService,
    private readonly identitiesRepository: IdentitiesRepository,
    private readonly tenantMembershipsRepository: TenantMembershipsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly rolesRepository: RolesRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly refreshTokensPlatformRepository: RefreshTokensPlatformRepository,
    private readonly passwordService: PasswordService,
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly csrfTokenService: CsrfTokenService,
    private readonly jwtService: JwtService,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
  ) {}

  /** `tenant_settings.timezone` for `tenantId`, defaulting exactly like
   * `TenantSettingsService.getEffective` does for a tenant that has never written its own row
   * (F18-01). Read-only, no permission check — timezone is deliberately not gated the way the rest
   * of tenant settings is (`GAP-TZ-VISIBILITY`: every authenticated tenant member may know their
   * own tenant's timezone; only business hours / write access stay behind
   * `administration.settings.*`). */
  private async resolveTenantTimezone(tx: TenantTransaction, tenantId: string): Promise<string> {
    const row = await this.tenantSettingsRepository.find(tx, tenantId);
    return row?.timezone ?? DEFAULT_TIMEZONE;
  }

  /**
   * Self-service registration = a brand-new tenant + its first admin `users` row (unchanged) +
   * the global `identities` row and `tenant_memberships` link (016-C). If the email already has
   * an identity (the person is registering a second company), that identity keeps its existing
   * credential — the password supplied here provisions the new `users` row and is only used as
   * the identity credential when the identity is new.
   */
  async register(input: RegisterInput, meta: SessionRequestMeta): Promise<IssuedSession> {
    const email = normalizeEmail(input.email);
    const passwordHash = await this.passwordService.hash(input.password);

    const { tenantId, tenantSlug, userId } = await this.tenantProvisioningService.provision({
      companyName: input.companyName,
      adminEmail: email,
      adminPasswordHash: passwordHash,
      adminFullName: input.fullName,
    });

    const { identityId } = await this.identityProvisioningService.provisionMembership({
      tenantId,
      userId,
      email,
      passwordHash,
      fullName: input.fullName,
    });

    const membership: ActiveMembership = {
      membershipId: '',
      identityId,
      tenantId,
      tenantName: input.companyName,
      tenantSlug,
      userId,
    };
    const session = await this.issueTenantSession(membership, meta);
    if (!session) {
      throw invalidSession();
    }
    return session;
  }

  /**
   * Step 1 of login (016-C): `{ email, password }` only. Resolves a global identity, validates
   * the credential against `identities.password_hash`, then branches on how many fully-active
   * memberships it has:
   *  - exactly one -> a real session for that tenant.
   *  - more than one -> a short-lived, permission-less selection token + the list of companies
   *    (returned ONLY here, after the credentials are validated — never from an email alone).
   */
  async login(input: LoginInput, meta: SessionRequestMeta): Promise<IssuedSession | TenantSelectionRequired> {
    const email = normalizeEmail(input.email);
    const identity = await this.identitiesRepository.findByEmail(email);

    // `disabled` and `pending_credential` both fail here, identically to "no such identity" and
    // "wrong password" — a `pending_credential` identity has a NULL password_hash and must set a
    // single credential (a later prompt) before it can log in; no fallback to users.password_hash.
    if (!identity || identity.status !== 'active' || identity.passwordHash === null) {
      await this.passwordService.verify(DUMMY_PASSWORD_HASH, input.password);
      throw invalidCredentials();
    }

    const passwordOk = await this.passwordService.verify(identity.passwordHash, input.password);
    if (!passwordOk) {
      throw invalidCredentials();
    }

    const memberships = await this.tenantMembershipsRepository.listActiveForIdentity(identity.id);
    if (memberships.length === 0) {
      throw invalidCredentials();
    }

    await this.identitiesRepository.touchLastLogin(identity.id);

    if (memberships.length === 1) {
      const session = await this.issueTenantSession(memberships[0] as ActiveMembership, meta);
      if (!session) {
        throw invalidCredentials();
      }
      return session;
    }

    const selection = await this.accessTokenService.issueSelection(identity.id);
    return {
      kind: 'tenant-selection',
      selectionToken: selection.token,
      selectionTokenTtlSeconds: selection.expiresInSeconds,
      availableTenants: memberships.map((m) => ({ tenantId: m.tenantId, name: m.tenantName })),
    };
  }

  /**
   * Step 2 of a multi-membership login (016-C). The `tenantId` is never trusted on its own — the
   * selection token's `sub` (an identity id) plus a live `findActiveForIdentityAndTenant` check is
   * what authorizes the session.
   */
  async selectTenant(
    rawSelectionToken: string | undefined,
    tenantId: string,
    meta: SessionRequestMeta,
  ): Promise<IssuedSession> {
    if (!rawSelectionToken) {
      throw invalidSelection();
    }
    let payload: SelectionTokenPayload;
    try {
      const verified = await this.jwtService.verifyAsync<SelectionTokenPayload>(rawSelectionToken, {
        secret: this.authConfig.jwtSecret,
      });
      if (!isSelectionTokenPayload(verified)) {
        throw invalidSelection();
      }
      payload = verified;
    } catch {
      throw invalidSelection();
    }

    const identity = await this.identitiesRepository.findById(payload.sub);
    if (!identity || identity.status !== 'active') {
      throw invalidSelection();
    }

    const membership = await this.tenantMembershipsRepository.findActiveForIdentityAndTenant(identity.id, tenantId);
    if (!membership) {
      throw invalidSelection();
    }

    const session = await this.issueTenantSession(membership, meta);
    if (!session) {
      throw invalidSelection();
    }
    return session;
  }

  async refresh(rawRefreshToken: string | undefined, meta: SessionRequestMeta): Promise<IssuedSession> {
    if (!rawRefreshToken) {
      throw invalidSession();
    }
    const tokenHash = this.refreshTokenService.hash(rawRefreshToken);
    const existing = await this.refreshTokensPlatformRepository.findByHash(tokenHash);
    if (!existing) {
      throw invalidSession();
    }

    if (existing.revokedAt || existing.expiresAt.getTime() < Date.now()) {
      if (existing.revokedAt) {
        // Reuse of an already-rotated/revoked token — threat-model.md's "Stolen / replayed JWT":
        // assume compromise, kill every session for this user.
        await withTenantTransaction(existing.tenantId, (tx) =>
          this.refreshTokensRepository.revokeAllForUser(tx, existing.tenantId, existing.userId),
        );
      }
      throw invalidSession();
    }

    // One live cross-tenant check (016-C): the membership resolving `(tenantId, userId)` must be
    // active, and so must the tenant, the identity and the user — the same immediate-revocation
    // guarantee TenantGuard applies per request, applied here at rotation time. Replaces the
    // separate PROMPT 011-A/011-B tenant-status + user-status reads. Left unrevoked on a status
    // failure (same reactivation semantics PROMPT 011-A chose): a later re-activation lets this
    // same token work again.
    const membership = await this.tenantMembershipsRepository.findActiveForTenantAndUser(
      existing.tenantId,
      existing.userId,
    );
    if (!membership) {
      throw invalidSession();
    }

    const result = await withTenantTransaction(existing.tenantId, async (tx) => {
      const user = await this.usersRepository.findById(tx, existing.tenantId, existing.userId);
      if (!user || user.status !== 'active') {
        return undefined;
      }
      await this.refreshTokensRepository.revoke(tx, existing.tenantId, existing.id);
      const permissions = await this.rolesRepository.effectivePermissionsForUser(tx, user.id);
      const timezone = await this.resolveTenantTimezone(tx, existing.tenantId);
      const view: AuthenticatedUserView = {
        id: user.id,
        identityId: membership.identityId,
        tenantId: existing.tenantId,
        tenantSlug: existing.tenantSlug,
        email: user.email,
        fullName: user.fullName,
        status: user.status,
        permissions,
        timezone,
      };
      return this.issueSessionTokens(tx, view, meta, existing.id);
    });
    if (!result) {
      throw invalidSession();
    }
    return result;
  }

  /** Idempotent by design — logging out with an already-invalid/missing token still succeeds and
   * never reveals whether the presented token was valid. */
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }
    const tokenHash = this.refreshTokenService.hash(rawRefreshToken);
    const existing = await this.refreshTokensPlatformRepository.findByHash(tokenHash);
    if (!existing || existing.revokedAt) {
      return;
    }
    await withTenantTransaction(existing.tenantId, (tx) =>
      this.refreshTokensRepository.revoke(tx, existing.tenantId, existing.id),
    );
  }

  async me(userId: string, identityId: string, tenantId: string, tenantSlug: string): Promise<AuthenticatedUserView> {
    return withTenantTransaction(tenantId, async (tx) => {
      const user = await this.usersRepository.findById(tx, tenantId, userId);
      if (!user || user.status !== 'active') {
        throw invalidSession();
      }
      const permissions = await this.rolesRepository.effectivePermissionsForUser(tx, user.id);
      const timezone = await this.resolveTenantTimezone(tx, tenantId);
      return {
        id: user.id,
        identityId,
        tenantId,
        tenantSlug,
        email: user.email,
        fullName: user.fullName,
        status: user.status,
        permissions,
        timezone,
      };
    });
  }

  /** Enters the membership's tenant transaction, loads permissions, and mints the session. Returns
   * `undefined` only if the underlying `users` row vanished between the platform check and here
   * (a race the caller turns into a generic error). */
  private async issueTenantSession(
    membership: ActiveMembership,
    meta: SessionRequestMeta,
  ): Promise<IssuedSession | undefined> {
    return withTenantTransaction(membership.tenantId, async (tx) => {
      const user = await this.usersRepository.findById(tx, membership.tenantId, membership.userId);
      if (!user || user.status !== 'active') {
        return undefined;
      }
      const permissions = await this.rolesRepository.effectivePermissionsForUser(tx, user.id);
      const timezone = await this.resolveTenantTimezone(tx, membership.tenantId);
      const view: AuthenticatedUserView = {
        id: user.id,
        identityId: membership.identityId,
        tenantId: membership.tenantId,
        tenantSlug: membership.tenantSlug,
        email: user.email,
        fullName: user.fullName,
        status: user.status,
        permissions,
        timezone,
      };
      return this.issueSessionTokens(tx, view, meta);
    });
  }

  private async issueSessionTokens(
    tx: TenantTransaction,
    user: AuthenticatedUserView,
    meta: SessionRequestMeta,
    rotatedFromId?: string,
  ): Promise<IssuedSession> {
    const access = await this.accessTokenService.issue(user.id, user.identityId, user.tenantId, user.tenantSlug);
    const refresh = this.refreshTokenService.generate();

    await this.refreshTokensRepository.create(tx, {
      id: generateId(),
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
      rotatedFromId,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });

    return {
      kind: 'session',
      accessToken: access.token,
      accessTokenTtlSeconds: access.expiresInSeconds,
      refreshToken: refresh.token,
      refreshTokenTtlSeconds: Math.round((refresh.expiresAt.getTime() - Date.now()) / 1000),
      csrfToken: this.csrfTokenService.generate(),
      user,
    };
  }
}
