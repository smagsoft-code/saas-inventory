import { Controller, Get, Param, UseGuards, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/decorators/skip-csrf.decorator';
import { QrPublicLocationDto, QrPublicProductDto, type QrPublicResponseDto } from './dto/qr-public-response.dto';
import { QrPublicThrottlerGuard } from './qr-public-throttler.guard';
import { QrPublicService } from './qr-public.service';

/**
 * `GET /q/:code` — api.md#public-endpoints' literal documented route, kept unprefixed and
 * unversioned like `GET /health` (main.ts's `setGlobalPrefix` exclude list + `@Version(VERSION_NEUTRAL)`)
 * since this URL is meant to be embedded in a physical, printed QR image — `/api/v1/q/:code` baked
 * into a label that outlives any particular API version would be a much worse contract than a
 * stable, version-neutral URL, the same reasoning `GET /health` already established for container
 * healthchecks. `@Public()` bypasses JwtAuthGuard/TenantGuard (no session exists on this route);
 * `@SkipCsrf()` is technically redundant (GET is already a CsrfGuard-safe method) but kept explicit
 * for the same self-documenting reason auth.controller.ts pairs it with @Public() on its own routes.
 */
@ApiTags('qr-public')
@ApiExtraModels(QrPublicProductDto, QrPublicLocationDto)
@Controller('q')
export class QrPublicController {
  constructor(private readonly qrPublicService: QrPublicService) {}

  @Get(':code')
  @Version(VERSION_NEUTRAL)
  @Public()
  @SkipCsrf()
  @UseGuards(QrPublicThrottlerGuard)
  @ApiOkResponse({ schema: { oneOf: [{ $ref: getSchemaPath(QrPublicProductDto) }, { $ref: getSchemaPath(QrPublicLocationDto) }] } })
  async resolve(@Param('code') code: string): Promise<QrPublicResponseDto> {
    return this.qrPublicService.resolve(code);
  }
}
