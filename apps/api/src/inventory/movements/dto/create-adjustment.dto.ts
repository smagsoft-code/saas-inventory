import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Length } from 'class-validator';

const ADJUSTMENT_MOVEMENT_TYPES = ['RECEIPT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] as const;

/** The only movement types a manual, non-transfer stock write can create — RECEIPT (an operational
 * inbound event not tied to a transfer, e.g. a direct supplier delivery) and ADJUSTMENT_IN /
 * ADJUSTMENT_OUT (a correction, e.g. a physical-count discrepancy or write-off). The remaining
 * movement types (TRANSFER_OUT, TRANSFER_IN, RESERVATION, RESERVATION_RELEASE, COMMITMENT,
 * COMMITMENT_RELEASE, INITIAL_STOCK, SALE, RETURN) are never client-selectable here — those are
 * either derived entirely by the transfer state machine (inventory/transfers/) or belong to a later
 * phase (SALES/Excel import). No `tenantId`/`actorId`/`balanceAfter` field — mass-assignment
 * posture identical to every other create DTO in this codebase. */
export class CreateAdjustmentDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  productVariantId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  locationId!: string;

  @ApiProperty({ enum: ADJUSTMENT_MOVEMENT_TYPES })
  @IsIn(ADJUSTMENT_MOVEMENT_TYPES)
  movementType!: (typeof ADJUSTMENT_MOVEMENT_TYPES)[number];

  @ApiProperty({ type: Number, description: 'Positive magnitude — direction comes from movementType.' })
  @IsNumber()
  @IsPositive()
  quantity!: number;

  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @IsString()
  @Length(1, 500)
  reason!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'When the physical movement actually happened, if different from now (a backdated count correction).',
  })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
