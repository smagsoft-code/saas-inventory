import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class SupportWarehouseResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ enum: ['active', 'inactive'] })
  status!: string;
}

/** SUPPORT_WRITE's one curated action (ADR-0036 §9's worked example) — deliberately just the
 * status field, matching the column-level UPDATE grant (migration 0033): this DTO cannot express
 * anything the database connection itself is not already restricted to. */
export class SetSupportWarehouseStatusDto {
  @ApiProperty({ enum: ['active', 'inactive'] })
  @IsIn(['active', 'inactive'])
  status!: 'active' | 'inactive';
}
