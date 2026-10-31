// Must be evaluated BEFORE any DTO module: @nestjs/swagger's decorators call Reflect.defineMetadata at class-definition time.
// Test support only (see qa-dto-contracts.ts). Resolved from apps/api, which is where the DTOs themselves get it.
import { createRequire } from 'node:module';

createRequire(new URL('../../apps/api/package.json', import.meta.url))('reflect-metadata');
