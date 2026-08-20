import { Controller, Get, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';

interface HealthStatus {
  status: 'ok';
  timestamp: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  // Undoes the two effects `setGlobalPrefix`'s `exclude: ['health']` (main.ts) does NOT cover:
  // global URI versioning still prepends /v1 to an unversioned route (VERSION_NEUTRAL turns that
  // off for this endpoint), and the global JwtAuthGuard still requires a session regardless of
  // prefix exclusion (@Public() opts out — see jwt-auth.guard.ts). Without both, this endpoint
  // 404s/401s instead of serving the plain `GET /health` docs/architecture/api.md documents as an
  // explicitly public, unauthenticated route for container healthchecks (found live, Prompt 05-B).
  @Version(VERSION_NEUTRAL)
  @Public()
  @ApiOkResponse({ description: 'The API process is up and accepting requests.' })
  check(): HealthStatus {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
