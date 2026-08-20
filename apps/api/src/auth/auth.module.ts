import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { getAuthConfig } from '../common/config/auth-config';
import { AuthController } from './auth.controller';
import { CsrfTokenService } from './csrf/csrf-token.service';
import { PasswordService } from './password/password.service';
import { RefreshTokensPlatformRepository } from './repositories/refresh-tokens-platform.repository';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';
import { RolesRepository } from './repositories/roles.repository';
import { TenantsPlatformRepository } from './repositories/tenants-platform.repository';
import { UsersRepository } from './repositories/users.repository';
import { AuthService } from './services/auth.service';
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
  controllers: [AuthController],
  providers: [
    AuthService,
    TenantProvisioningService,
    PasswordService,
    AccessTokenService,
    RefreshTokenService,
    CsrfTokenService,
    UsersRepository,
    RolesRepository,
    RefreshTokensRepository,
    RefreshTokensPlatformRepository,
    TenantsPlatformRepository,
  ],
})
export class AuthModule {}
