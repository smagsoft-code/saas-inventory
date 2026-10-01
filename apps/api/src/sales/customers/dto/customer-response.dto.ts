import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CustomerResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['cedula', 'ruc', 'pasaporte'] })
  type!: string;

  @ApiProperty({ type: String })
  firstName!: string;

  @ApiPropertyOptional({ type: String })
  lastName?: string;

  /** Derived (`concat_ws(' ', first_name, last_name)`, migration 0037) — read-only, never accepted
   * on create/update. */
  @ApiProperty({ type: String })
  displayName!: string;

  /** Required on create going forward, but optional here — legacy rows predating this field's
   * mandatory format validation (migration 0037) may still have none on file. */
  @ApiPropertyOptional({ type: String })
  taxId?: string;

  @ApiPropertyOptional({ type: String })
  email?: string;

  @ApiPropertyOptional({ type: String })
  phone?: string;

  @ApiPropertyOptional({ type: String })
  address?: string;

  @ApiProperty({ enum: ['active', 'inactive'] })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
