import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Length, ValidateNested } from 'class-validator';

const INCIDENT_TYPES = ['shortage', 'damage', 'excess'] as const;

export class ReceiveTransferItemDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  transferItemId!: string;

  @ApiProperty({ type: Number, description: 'This receiving event\'s quantity for this item — not the running total.' })
  @IsNumber()
  @IsPositive()
  quantityReceived!: number;

  @ApiPropertyOptional({ enum: INCIDENT_TYPES })
  @IsOptional()
  @IsIn(INCIDENT_TYPES)
  incidentType?: (typeof INCIDENT_TYPES)[number];

  @ApiPropertyOptional({ type: String, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  incidentNotes?: string;
}

/** One receiving EVENT — may cover some or all of a transfer's items, and a transfer may be received
 * across several of these calls (partial receipt). Client-supplied Idempotency-Key header (required,
 * not part of the body) guards against a retried submission double-counting the same event —
 * database.md#idempotency's "genuinely repeatable user actions" pattern, scope = 'transfer.receive'. */
export class ReceiveTransferDto {
  @ApiProperty({ type: [ReceiveTransferItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveTransferItemDto)
  items!: ReceiveTransferItemDto[];

  @ApiPropertyOptional({ type: String, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}
