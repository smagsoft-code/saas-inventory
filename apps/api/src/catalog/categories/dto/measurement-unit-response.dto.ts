import { ApiProperty } from '@nestjs/swagger';

export class MeasurementUnitResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String })
  label!: string;

  @ApiProperty({ type: String })
  dimension!: string;
}
