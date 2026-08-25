import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AUTH_CONFIG, getAuthConfig } from './config/auth-config';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { TenantGuard } from './guards/tenant.guard';
import { ObjectStorageService } from './storage/object-storage.service';

/**
 * Cross-cutting infrastructure shared by every module (backend.md#cross-cutting-concerns):
 * the global guard chain in the exact order api.md#request-flow specifies (auth -> tenant -> csrf
 * -> permissions), the single global exception filter, and (Prompt 10) the one S3-compatible
 * ObjectStorageService every module needing file storage shares (IMPORT is the first consumer).
 * Global so no future feature module has to remember to wire these up itself.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [
    { provide: AUTH_CONFIG, useFactory: getAuthConfig },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    ObjectStorageService,
  ],
  exports: [AUTH_CONFIG, JwtModule, ObjectStorageService],
})
export class CommonModule {}
