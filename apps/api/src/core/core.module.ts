import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/password/password.service';
import { IdentitiesRepository } from '../auth/repositories/identities.repository';
import { RolesRepository } from '../auth/repositories/roles.repository';
import { TenantMembershipsRepository } from '../auth/repositories/tenant-memberships.repository';
import { TenantsPlatformRepository } from '../auth/repositories/tenants-platform.repository';
import { UsersRepository } from '../auth/repositories/users.repository';
import { IdentityProvisioningService } from '../auth/services/identity-provisioning.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';
import { TenantController } from './tenant/tenant.controller';
import { TenantService } from './tenant/tenant.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

/**
 * modules.md#core — tenant/user/role administration (Prompt 05-A). Reuses the exact repository
 * classes auth/ already established for `users`/`roles`/`tenants` (UsersRepository,
 * RolesRepository, TenantsPlatformRepository) rather than a parallel set — CLAUDE.md's "no crear
 * un sistema paralelo". Those classes have no constructor dependencies of their own (or only
 * depend on the globally-provided PLATFORM_DATABASE token), so registering them here alongside
 * AuthModule's own registration is safe: NestJS gives each module its own stateless instance of
 * the same class, not a second competing implementation.
 */
@Module({
  controllers: [TenantController, UsersController, RolesController],
  providers: [
    TenantService,
    UsersService,
    RolesService,
    PasswordService,
    AuditLogService,
    UsersRepository,
    RolesRepository,
    TenantsPlatformRepository,
    // 016-C: creating a user now also links it into the global identity model — same
    // "own stateless instance" convention as the repositories above.
    IdentityProvisioningService,
    IdentitiesRepository,
    TenantMembershipsRepository,
  ],
})
export class CoreModule {}
