import { Injectable, UnauthorizedException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { CsrfTokenService } from '../csrf/csrf-token.service';
import type { PasswordService } from '../password/password.service';
import type { RefreshTokensPlatformRepository } from '../repositories/refresh-tokens-platform.repository';
import type { RefreshTokensRepository } from '../repositories/refresh-tokens.repository';
import type { RolesRepository } from '../repositories/roles.repository';
import type { TenantsPlatformRepository } from '../repositories/tenants-platform.repository';
import type { UsersRepository } from '../repositories/users.repository';
import type { AccessTokenService } from '../tokens/access-token.service';
import type { RefreshTokenService } from '../tokens/refresh-token.service';
import type { TenantProvisioningService } from './tenant-provisioning.service';
import { normalizeEmail, normalizeSlug } from '../util/normalize';

/** A fixed, valid Argon2id hash of a value nobody can log in with — verified against on a
 * nonexistent-user login attempt so that path costs roughly the same time as a real password
 * check, closing the timing side-channel that would otherwise let a caller distinguish
 * "no such user" from "wrong password" by response latency (security.md §6). */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$Wk+k4Aqt+cNKE8Icr0KpWA$5llxil2sQA4Rx7RKjXDW2hQ/6E+CEGDr2eypUF2nc4Q';

export interface SessionRequestMeta {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export interface AuthenticatedUserView {
  id: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  fullName: string;
  status: string;
  permissions: string[];
}

export interface IssuedSession {
  accessToken: string;
  accessTokenTtlSeconds: number;
  refreshToken: string;
  refreshTokenTtlSeconds: number;
  csrfToken: string;
  user: AuthenticatedUserView;
}

export interface RegisterInput {
  companyName: string;
  email: string;
  password: string;
  fullName: string;
}

export interface LoginInput {
  tenantSlug: string;
  email: string;
  password: string;
}

function invalidCredentials(): UnauthorizedException {
  // One identical message regardless of which part was wrong (nonexistent tenant, nonexistent
  // user, wrong password, or a disabled/invited account) — security.md §6.
  return new UnauthorizedException('Invalid tenant, email, or password.');
}

function invalidSession(): UnauthorizedException {
  return new UnauthorizedException('Invalid or expired session.');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly tenantProvisioningService: TenantProvisioningService,
    private readonly tenantsPlatformRepository: TenantsPlatformRepository,
    private readonly usersRepository: UsersRepository,
    private readonly rolesRepository: RolesRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly refreshTokensPlatformRepository: RefreshTokensPlatformRepository,
    private readonly passwordService: PasswordService,
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly csrfTokenService: CsrfTokenService,
  ) {}

  async register(input: RegisterInput, meta: SessionRequestMeta): Promise<IssuedSession> {
    const email = normalizeEmail(input.email);
    const passwordHash = await this.passwordService.hash(input.password);

    const { tenantId, tenantSlug, userId } = await this.tenantProvisioningService.provision({
      companyName: input.companyName,
      adminEmail: email,
      adminPasswordHash: passwordHash,
      adminFullName: input.fullName,
    });

    return withTenantTransaction(tenantId, async (tx) => {
      const permissions = await this.rolesRepository.effectivePermissionsForUser(tx, userId);
      const user: AuthenticatedUserView = {
        id: userId,
        tenantId,
        tenantSlug,
        email,
        fullName: input.fullName,
        status: 'active',
        permissions,
      };
      return this.issueSession(tx, user, meta);
    });
  }

  async login(input: LoginInput, meta: SessionRequestMeta): Promise<IssuedSession> {
    const email = normalizeEmail(input.email);
    const tenant = await this.tenantsPlatformRepository.findBySlug(normalizeSlug(input.tenantSlug));

    if (!tenant || tenant.status !== 'active') {
      await this.passwordService.verify(DUMMY_PASSWORD_HASH, input.password);
      throw invalidCredentials();
    }

    const result = await withTenantTransaction(tenant.id, async (tx) => {
      const user = await this.usersRepository.findByEmail(tx, tenant.id, email);
      if (!user || user.status !== 'active') {
        await this.passwordService.verify(DUMMY_PASSWORD_HASH, input.password);
        return undefined;
      }

      const passwordOk = await this.passwordService.verify(user.passwordHash, input.password);
      if (!passwordOk) {
        return undefined;
      }

      await this.usersRepository.touchLastLogin(tx, tenant.id, user.id);
      const permissions = await this.rolesRepository.effectivePermissionsForUser(tx, user.id);
      const view: AuthenticatedUserView = {
        id: user.id,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        email: user.email,
        fullName: user.fullName,
        status: user.status,
        permissions,
      };
      return this.issueSession(tx, view, meta);
    });

    if (!result) {
      throw invalidCredentials();
    }
    return result;
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
        // A revoked (already-rotated, or already-logged-out) token being presented again is
        // exactly the reuse pattern threat-model.md's "Stolen / replayed JWT" describes — assume
        // compromise and kill every session for this user, not just this one token.
        await withTenantTransaction(existing.tenantId, (tx) =>
          this.refreshTokensRepository.revokeAllForUser(tx, existing.tenantId, existing.userId),
        );
      }
      throw invalidSession();
    }

    const result = await withTenantTransaction(existing.tenantId, async (tx) => {
      const user = await this.usersRepository.findById(tx, existing.tenantId, existing.userId);
      if (!user || user.status !== 'active') {
        return undefined;
      }
      await this.refreshTokensRepository.revoke(tx, existing.tenantId, existing.id);
      const permissions = await this.rolesRepository.effectivePermissionsForUser(tx, user.id);
      const view: AuthenticatedUserView = {
        id: user.id,
        tenantId: existing.tenantId,
        tenantSlug: existing.tenantSlug,
        email: user.email,
        fullName: user.fullName,
        status: user.status,
        permissions,
      };
      return this.issueSession(tx, view, meta, existing.id);
    });

    if (!result) {
      throw invalidSession();
    }
    return result;
  }

  /** Idempotent by design — logging out with an already-invalid/missing token still succeeds
   * (the caller's goal, "no active credentials afterward", is already satisfied). Never reveals
   * whether the presented token was valid. */
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

  async me(userId: string, tenantId: string, tenantSlug: string): Promise<AuthenticatedUserView> {
    return withTenantTransaction(tenantId, async (tx) => {
      const user = await this.usersRepository.findById(tx, tenantId, userId);
      if (!user || user.status !== 'active') {
        throw invalidSession();
      }
      const permissions = await this.rolesRepository.effectivePermissionsForUser(tx, user.id);
      return {
        id: user.id,
        tenantId,
        tenantSlug,
        email: user.email,
        fullName: user.fullName,
        status: user.status,
        permissions,
      };
    });
  }

  private async issueSession(
    tx: TenantTransaction,
    user: AuthenticatedUserView,
    meta: SessionRequestMeta,
    rotatedFromId?: string,
  ): Promise<IssuedSession> {
    const access = await this.accessTokenService.issue(user.id, user.tenantId, user.tenantSlug);
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
      accessToken: access.token,
      accessTokenTtlSeconds: access.expiresInSeconds,
      refreshToken: refresh.token,
      refreshTokenTtlSeconds: Math.round((refresh.expiresAt.getTime() - Date.now()) / 1000),
      csrfToken: this.csrfTokenService.generate(),
      user,
    };
  }
}
