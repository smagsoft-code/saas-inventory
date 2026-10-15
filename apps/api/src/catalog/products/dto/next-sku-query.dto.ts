import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class NextSkuQueryDto {
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description: 'Category whose first three letters give the code prefix. Omit for the default PRD prefix.',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
