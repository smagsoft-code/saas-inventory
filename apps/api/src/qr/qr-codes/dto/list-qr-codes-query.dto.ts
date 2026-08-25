import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { QR_TARGET_TYPES } from './create-qr-code.dto';

export class ListQrCodesQueryDto {
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

  @ApiPropertyOptional({ enum: QR_TARGET_TYPES })
  @IsOptional()
  @IsIn(QR_TARGET_TYPES)
  targetType?: (typeof QR_TARGET_TYPES)[number];

  @ApiPropertyOptional({ type: String, description: 'Filter to QR codes for this specific product variant or location.' })
  @IsOptional()
  @IsUUID()
  targetId?: string;
}
