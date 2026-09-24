import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Length, Min, ValidateIf } from 'class-validator';

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

  /** Mandatory for RECEIPT ("Agregar stock" — UI-UX-SPEC-001 §12: a supplier/production inbound
   * always has a known unit cost, so it is never allowed to default silently). Optional for
   * ADJUSTMENT_IN — when omitted there, the service defaults it to the variant's current moving
   * average cost (a found-inventory correction is assumed not to change the average). Ignored for
   * ADJUSTMENT_OUT — an outflow never carries a cost of its own, see kardex-costing.ts. */
  @ApiPropertyOptional({ type: Number, description: 'Unit cost of the inbound quantity. Required when movementType is RECEIPT.' })
  @ValidateIf((dto: CreateAdjustmentDto) => dto.movementType === 'RECEIPT' || dto.unitCost !== undefined)
  @IsNumber()
  @Min(0)
  unitCost?: number;
}
