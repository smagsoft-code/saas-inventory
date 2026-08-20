import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserLocationResponseDto {
  @ApiProperty({ type: String })
  locationId!: string;

  @ApiProperty({ type: String })
  assignedAt!: string;

  @ApiPropertyOptional({ type: String })
  assignedBy?: string | undefined;
}
