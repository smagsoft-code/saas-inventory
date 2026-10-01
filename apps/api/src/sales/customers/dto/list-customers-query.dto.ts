import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const CUSTOMER_TYPES = ['cedula', 'ruc', 'pasaporte'] as const;
const CUSTOMER_STATUSES = ['active', 'inactive'] as const;

/** Offset pagination (api.md#pagination) plus explicit, documented filters only (api.md#filtering).
 * `q` is the free-text search parameter (api.md#search) — a case-insensitive match against
 * firstName / lastName / taxId / email / phone, always tenant-scoped, never cross-tenant (§12). */
export class ListCustomersQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ enum: CUSTOMER_STATUSES })
  @IsOptional()
  @IsIn(CUSTOMER_STATUSES)
  status?: (typeof CUSTOMER_STATUSES)[number];

  @ApiPropertyOptional({ enum: CUSTOMER_TYPES })
  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  type?: (typeof CUSTOMER_TYPES)[number];

  @ApiPropertyOptional({ type: String, maxLength: 100, description: 'Free-text search: firstName / lastName / taxId / email / phone.' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;
}
