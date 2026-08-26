import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsPositive, IsUUID, Length, ValidateNested } from 'class-validator';

export class CreateReturnItemDto {
  @ApiProperty({ type: String, format: 'uuid', description: 'The order_items.id being returned.' })
  @IsUUID()
  orderItemId!: string;

  @ApiProperty({ type: Number, description: 'Quantity returned for this line — must not exceed what remains returnable.' })
  @IsNumber()
  @IsPositive()
  quantity!: number;
}

/**
 * Files a return request against a **confirmed** order (§8). No `tenantId`/`requestedBy`/`status` —
 * tenant is always CurrentTenant, requestedBy is the authenticated actor, a return always starts
 * `requested`. `locationId` is where the returned goods are physically received; the per-line
 * disposition + re-entry location are decided later, at inspection (§15-§16). Requires a
 * client-supplied `Idempotency-Key` header (not part of the body), scope `sales_return.create`.
 */
export class CreateReturnDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ type: String, format: 'uuid', description: 'Location where the returned goods are received.' })
  @IsUUID()
  locationId!: string;

  @ApiProperty({ type: String, minLength: 3, maxLength: 500 })
  @Length(3, 500)
  reason!: string;

  @ApiProperty({ type: [CreateReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  items!: CreateReturnItemDto[];
}
