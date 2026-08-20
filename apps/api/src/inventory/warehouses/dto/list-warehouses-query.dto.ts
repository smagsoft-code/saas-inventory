import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const WAREHOUSE_STATUSES = ['active', 'inactive'] as const;

export class ListWarehousesQueryDto {
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

  @ApiPropertyOptional({ enum: WAREHOUSE_STATUSES })
  @IsOptional()
  @IsIn(WAREHOUSE_STATUSES)
  status?: (typeof WAREHOUSE_STATUSES)[number];
}
