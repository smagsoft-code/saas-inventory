import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiPropertyOptional({ type: String })
  parentCategoryId?: string | undefined;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  slug!: string;

  @ApiProperty({ enum: ['active', 'inactive'] })
  status!: string;

  @ApiProperty({ type: String })
  createdAt!: string;
}
