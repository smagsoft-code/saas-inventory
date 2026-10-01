import { ApiProperty } from '@nestjs/swagger';
import { BusinessHoursEntryDto } from './business-hours-entry.dto';

/** The effective configuration — a stored tenant_settings row's values, or the system defaults
 * (§10: "effective = tenant override ?? system default") when the tenant has never written one.
 * `id`/`updatedAt` are `null` in the latter case, so a caller can tell "using defaults" apart from
 * "explicitly configured" without a second endpoint. */
export class TenantSettingsResponseDto {
  @ApiProperty({ type: String })
  timezone!: string;

  @ApiProperty({ type: [BusinessHoursEntryDto] })
  businessHours!: BusinessHoursEntryDto[];

  /** Transferencias workflow config (F17-TRANSFERS-AUDIT §1) — whether a transfer must pass
   * through a manual "Aprobar"/"Preparar" action to advance, or skips that gate automatically.
   * `dispatched`/`received` are never configurable — see `transfers.service.ts`. */
  @ApiProperty({ type: Boolean })
  transfersRequireApproval!: boolean;

  @ApiProperty({ type: Boolean })
  transfersRequirePreparation!: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'null when the tenant has never saved custom settings.' })
  updatedAt!: string | null;
}
