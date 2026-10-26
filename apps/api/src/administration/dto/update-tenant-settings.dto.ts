import { ApiExtraModels, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, ValidateNested } from 'class-validator';
import { BusinessHoursEntryDto } from './business-hours-entry.dto';

/** Every IANA timezone name Node itself recognizes — the same source of truth the runtime uses to
 * interpret a timezone, not a hand-maintained list that can drift out of date (rule 21's "valid
 * reference" requirement, applied to a platform-provided reference set instead of a tenant-owned
 * table) — plus `UTC`. `UTC` is the platform default (`DEFAULT_TIMEZONE`) and a valid zone for
 * `Intl.DateTimeFormat`, but `Intl.supportedValuesOf('timeZone')` does not list it (Node 24.19: 418
 * names, no `UTC`), so without this a tenant could never set its timezone back to the default
 * (DEFECT-TZ-DEFAULT-UNSETTABLE). Exact match only: `utc`, `UTC+5`, `Etc/UTC` stay rejected.
 * Computed once at module load, not per-request. */
const IANA_TIME_ZONES = [...Intl.supportedValuesOf('timeZone'), 'UTC'];

/** PATCH semantics for both fields (either may be omitted to leave it unchanged) — `businessHours`
 * itself is whole-array-replace when present (same PUT-shaped-field convention as
 * SetCategoryAttributesDto), never a per-day merge, so the response always reflects exactly what
 * was sent. Whitelisted by main.ts's global ValidationPipe (forbidNonWhitelisted: true) — no
 * arbitrary key ever reaches the service layer (§18 mass-assignment). */
@ApiExtraModels(BusinessHoursEntryDto)
export class UpdateTenantSettingsDto {
  @ApiPropertyOptional({ type: String, example: 'America/Bogota', description: 'An IANA timezone name.' })
  @IsOptional()
  @IsIn(IANA_TIME_ZONES)
  timezone?: string;

  @ApiPropertyOptional({
    type: 'array',
    items: { $ref: getSchemaPath(BusinessHoursEntryDto) },
    description: 'Replaces the full set. At most one entry per dayOfWeek (0-6) — validated server-side.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => BusinessHoursEntryDto)
  businessHours?: BusinessHoursEntryDto[];

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Whether creating a transfer still requires a manual "Aprobar" action before it can be prepared/dispatched.',
  })
  @IsOptional()
  @IsBoolean()
  transfersRequireApproval?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Whether an approved transfer still requires a manual "Preparar" action (stock reservation) before it can be dispatched.',
  })
  @IsOptional()
  @IsBoolean()
  transfersRequirePreparation?: boolean;
}
