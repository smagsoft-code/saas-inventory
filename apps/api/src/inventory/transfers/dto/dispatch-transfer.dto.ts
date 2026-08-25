import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsPositive, IsUUID, ValidateNested } from 'class-validator';

export class DispatchTransferItemDto {
  @IsUUID()
  transferItemId!: string;

  /** Defaults to the item's full quantityRequested when the item is omitted from the request
   * entirely — see dispatch-transfer.dto.ts's class doc. */
  @IsNumber()
  @IsPositive()
  quantityDispatched!: number;
}

/** database.md#inventory-transfers-and-in-transit-stock: "If quantity_dispatched < quantity_requested
 * (couldn't send it all), the shortfall's reservation is simply released with no corresponding
 * TRANSFER_OUT." Omitting `items` entirely dispatches every item at its full quantityRequested — the
 * common case (nothing short-shipped). Naming a subset of items here overrides just those items'
 * dispatched quantity; any transfer item NOT named still dispatches at its full quantityRequested. */
export class DispatchTransferDto {
  @ApiPropertyOptional({ type: [DispatchTransferItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DispatchTransferItemDto)
  items?: DispatchTransferItemDto[];
}
