import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

const OPTION_STATUSES = ['active', 'inactive'] as const;

export class CreateAttributeOptionDto {
  @ApiProperty({ type: String, description: 'Stable value key, e.g. "black".' })
  @IsString()
  @Length(1, 60)
  code!: string;

  @ApiProperty({ type: String, description: 'Display label, e.g. "Negro".' })
  @IsString()
  @Length(1, 120)
  label!: string;

  @ApiPropertyOptional({ type: Number, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateAttributeOptionDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  label?: string;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({ enum: OPTION_STATUSES })
  @IsOptional()
  @IsIn(OPTION_STATUSES)
  status?: (typeof OPTION_STATUSES)[number];
}

export class AttributeOptionResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  attributeDefinitionId!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String })
  label!: string;

  @ApiProperty({ type: Number })
  displayOrder!: number;

  @ApiProperty({ enum: OPTION_STATUSES })
  status!: string;
}
