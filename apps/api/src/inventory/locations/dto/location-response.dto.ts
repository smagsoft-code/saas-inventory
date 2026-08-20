import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LocationResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  warehouseId!: string;

  @ApiPropertyOptional({ type: String })
  parentLocationId?: string | undefined;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: Boolean })
  isSellable!: boolean;

  @ApiProperty({ enum: ['active', 'inactive'] })
  status!: string;

  @ApiProperty({ type: String })
  createdAt!: string;
}
