import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { getAuthConfig } from '../common/config/auth-config';
import { AuthController } from './auth.controller';
import { CsrfTokenService } from './csrf/csrf-token.service';
import { PasswordService } from './password/password.service';
import { IdentitiesRepository } from './repositories/identities.repository';
import { PlatformAdminsRepository } from './repositories/platform-admins.repository';
import { PlatformRefreshTokensRepository } from './repositories/platform-refresh-tokens.repository';
import { RefreshTokensPlatformRepository } from './repositories/refresh-tokens-platform.repository';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';
import { RolesRepository } from './repositories/roles.repository';
import { TenantMembershipsRepository } from './repositories/tenant-memberships.repository';
import { TenantsPlatformRepository } from './repositories/tenants-platform.repository';
import { UsersRepository } from './repositories/users.repository';
import { PlatformAuthController } from './platform-auth.controller';
import { AuthService } from './services/auth.service';
import { IdentityProvisioningService } from './services/identity-provisioning.service';
import { PlatformAuthService } from './services/platform-auth.service';
import { TenantProvisioningService } from './services/tenant-provisioning.service';
import { AccessTokenService } from './tokens/access-token.service';
import { RefreshTokenService } from './tokens/refresh-token.service';

const authConfig = getAuthConfig();

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'default', ttl: authConfig.rateLimit.ttlSeconds * 1000, limit: authConfig.rateLimit.max },
    ]),
  ],
  controllers: [AuthController, PlatformAuthController],
  providers: [
    AuthService,
    PlatformAuthService,
    TenantProvisioningService,
    IdentityProvisioningService,
    PasswordService,
    AccessTokenService,
    RefreshTokenService,
    CsrfTokenService,
    UsersRepository,
    RolesRepository,
    IdentitiesRepository,
    TenantMembershipsRepository,
    RefreshTokensRepository,
    RefreshTokensPlatformRepository,
    TenantsPlatformRepository,
    PlatformAdminsRepository,
    PlatformRefreshTokensRepository,
  ],
})
export class AuthModule {}
