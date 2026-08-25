import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Length, ValidateNested } from 'class-validator';

export class CreateTransferItemDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  productVariantId!: string;

  @ApiProperty({ type: Number, description: 'Quantity requested for this product — the source may end up dispatching less.' })
  @IsNumber()
  @IsPositive()
  quantityRequested!: number;
}

/** No `tenantId`/`requestedBy`/`status` field — tenant is always CurrentTenant, requestedBy is
 * always the authenticated actor, and every transfer always starts `draft` (the column default). */
export class CreateTransferDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  sourceLocationId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  destinationLocationId!: string;

  @ApiProperty({ type: [CreateTransferItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTransferItemDto)
  items!: CreateTransferItemDto[];

  @ApiPropertyOptional({ type: String, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}
