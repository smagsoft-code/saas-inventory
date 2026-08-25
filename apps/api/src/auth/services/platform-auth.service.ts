import { Injectable, UnauthorizedException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { CsrfTokenService } from '../csrf/csrf-token.service';
import { PasswordService } from '../password/password.service';
import { PlatformAdminsRepository, type PlatformAdminRow } from '../repositories/platform-admins.repository';
import { PlatformRefreshTokensRepository } from '../repositories/platform-refresh-tokens.repository';
import { AccessTokenService } from '../tokens/access-token.service';
import { RefreshTokenService } from '../tokens/refresh-token.service';
import type { SessionRequestMeta } from './auth.service';

/** Same fixed, valid Argon2id dummy hash as AuthService — closes the same timing side-channel
 * (security.md §6) for the platform-admin login path. Kept as its own constant rather than
 * exported/shared from auth.service.ts: the two login paths are deliberately independent code, not
 * sharing internals beyond the stateless services (PasswordService, AccessTokenService, ...). */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$Wk+k4Aqt+cNKE8Icr0KpWA$5llxil2sQA4Rx7RKjXDW2hQ/6E+CEGDr2eypUF2nc4Q';

export interface AuthenticatedPlatformAdminView {
  id: string;
  email: string;
  fullName: string;
  status: string;
}

export interface IssuedPlatformSession {
  accessToken: string;
  accessTokenTtlSeconds: number;
  refreshToken: string;
  refreshTokenTtlSeconds: number;
  csrfToken: string;
  admin: AuthenticatedPlatformAdminView;
}

function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException('Invalid email or password.');
}

function invalidSession(): UnauthorizedException {
  return new UnauthorizedException('Invalid or expired session.');
}

function toView(admin: PlatformAdminRow): AuthenticatedPlatformAdminView {
  return { id: admin.id, email: admin.email, fullName: admin.fullName, status: admin.status };
}

/**
 * SuperAdmin authentication (multi-tenancy.md#superadmin-vs-tenant, FASE 11) — structurally
 * parallel to AuthService, never sharing a code path with it: no `withTenantTransaction` (there is
 * no tenant), no tenant RBAC, a completely separate token/cookie/session-store namespace. Mirrors
 * AuthService's login/refresh/logout/me shape deliberately, so the two are easy to compare and
 * audit side by side, not because they are the same concern.
 */
@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly platformAdminsRepository: PlatformAdminsRepository,
    private readonly platformRefreshTokensRepository: PlatformRefreshTokensRepository,
    private readonly passwordService: PasswordService,
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly csrfTokenService: CsrfTokenService,
  ) {}

  async login(input: { email: string; password: string }, meta: SessionRequestMeta): Promise<IssuedPlatformSession> {
    const email = input.email.trim().toLowerCase();
    const admin = await this.platformAdminsRepository.findByEmail(email);
    if (!admin || admin.status !== 'active') {
      await this.passwordService.verify(DUMMY_PASSWORD_HASH, input.password);
      throw invalidCredentials();
    }

    const passwordOk = await this.passwordService.verify(admin.passwordHash, input.password);
    if (!passwordOk) {
      throw invalidCredentials();
    }

    return this.issueSession(admin, meta);
  }

  async refresh(rawRefreshToken: string | undefined, meta: SessionRequestMeta): Promise<IssuedPlatformSession> {
    if (!rawRefreshToken) {
      throw invalidSession();
    }
    const tokenHash = this.refreshTokenService.hash(rawRefreshToken);
    const existing = await this.platformRefreshTokensRepository.findByHash(tokenHash);
    if (!existing) {
      throw invalidSession();
    }

    if (existing.revokedAt || existing.expiresAt.getTime() < Date.now()) {
      if (existing.revokedAt) {
        // Reuse of an already-rotated/revoked token — assume compromise, kill every session for
        // this admin, same threat-model.md mitigation AuthService.refresh applies to tenant users.
        await this.platformRefreshTokensRepository.revokeAllForAdmin(existing.platformAdminId);
      }
      throw invalidSession();
    }

    const admin = await this.platformAdminsRepository.findById(existing.platformAdminId);
    if (!admin || admin.status !== 'active') {
      throw invalidSession();
    }

    await this.platformRefreshTokensRepository.revoke(existing.id);
    return this.issueSession(admin, meta, existing.id);
  }

  /** Idempotent by design, never reveals whether the presented token was valid — same posture as
   * AuthService.logout. */
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }
    const tokenHash = this.refreshTokenService.hash(rawRefreshToken);
    const existing = await this.platformRefreshTokensRepository.findByHash(tokenHash);
    if (!existing || existing.revokedAt) {
      return;
    }
    await this.platformRefreshTokensRepository.revoke(existing.id);
  }

  async me(adminId: string): Promise<AuthenticatedPlatformAdminView> {
    const admin = await this.platformAdminsRepository.findById(adminId);
    if (!admin || admin.status !== 'active') {
      throw invalidSession();
    }
    return toView(admin);
  }

  private async issueSession(
    admin: PlatformAdminRow,
    meta: SessionRequestMeta,
    rotatedFromId?: string,
  ): Promise<IssuedPlatformSession> {
    const access = await this.accessTokenService.issuePlatform(admin.id);
    const refresh = this.refreshTokenService.generate();

    await this.platformRefreshTokensRepository.create({
      id: generateId(),
      platformAdminId: admin.id,
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
      admin: toView(admin),
    };
  }
}
