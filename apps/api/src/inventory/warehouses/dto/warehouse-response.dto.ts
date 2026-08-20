import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WarehouseResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiPropertyOptional({ type: Object })
  address?: Record<string, unknown> | undefined;

  @ApiProperty({ enum: ['active', 'inactive'] })
  status!: string;

  @ApiProperty({ type: String })
  createdAt!: string;
}
