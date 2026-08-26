import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CustomerResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['individual', 'business'] })
  type!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiPropertyOptional({ type: String })
  taxId?: string;

  @ApiPropertyOptional({ type: String })
  email?: string;

  @ApiPropertyOptional({ type: String })
  phone?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  address?: Record<string, unknown>;

  @ApiProperty({ enum: ['active', 'inactive'] })
  status!: string;

  @ApiPropertyOptional({ type: String })
  notes?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
