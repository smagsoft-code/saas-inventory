import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, ValidateNested } from 'class-validator';

const DISPOSITIONS = ['restock', 'quarantine', 'damaged', 'scrap'] as const;

export class InspectReturnItemDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  returnItemId!: string;

  @ApiProperty({
    enum: DISPOSITIONS,
    description:
      'restock -> a sellable location (stock becomes available again); quarantine/damaged/scrap -> a non-sellable location (tracked, never counted as available) — ADR-0021.',
  })
  @IsIn(DISPOSITIONS)
  disposition!: (typeof DISPOSITIONS)[number];

  @ApiProperty({ type: String, format: 'uuid', description: 'Where the returned unit is placed for its disposition.' })
  @IsUUID()
  dispositionLocationId!: string;

  @ApiPropertyOptional({ type: String, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;
}

/**
 * Records the inspection decision for a return (§15). Sets each line's `disposition` +
 * `disposition_location_id` and transitions the return `requested`/`inspecting` -> `inspecting`. No
 * inventory is moved here — that happens at `/resolve` once every line has been inspected. Requires
 * `inventory.returns.manage` (the stock-sensitive half of the lifecycle).
 */
export class InspectReturnDto {
  @ApiProperty({ type: [InspectReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InspectReturnItemDto)
  items!: InspectReturnItemDto[];
}
