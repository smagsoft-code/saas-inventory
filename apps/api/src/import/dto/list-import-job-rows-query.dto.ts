import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const ROW_STATUSES = ['pending', 'valid', 'warning', 'invalid', 'imported', 'skipped'] as const;

/** Offset pagination, matching every other list endpoint in this codebase (movements, audit-style
 * lists) — database.md#preview flags cursor pagination as a candidate for this specific endpoint
 * given potentially 100,000 rows, but leaves it an explicit "PENDING DECISION, resolved
 * per-endpoint" (api.md#pagination). Offset is kept here for consistency with the rest of the API
 * surface; the `(tenant_id, import_job_id, status)` index supports either without a schema change,
 * so switching to cursor pagination later is a non-breaking, additive change. */
export class ListImportJobRowsQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 50;

  @ApiPropertyOptional({ enum: ROW_STATUSES })
  @IsOptional()
  @IsIn(ROW_STATUSES)
  status?: (typeof ROW_STATUSES)[number];
}
