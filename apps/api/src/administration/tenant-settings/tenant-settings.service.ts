import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction } from '../../database/tenant-context';
import type { BusinessHoursEntryDto } from '../dto/business-hours-entry.dto';
import type { TenantSettingsResponseDto } from '../dto/tenant-settings-response.dto';
import type { UpdateTenantSettingsDto } from '../dto/update-tenant-settings.dto';
import { TenantSettingsRepository, type TenantSettingsRow } from './tenant-settings.repository';

export interface AuditMeta {
  actorId: string;
  correlationId: string | undefined;
  ipAddress: string | undefined;
}

/** System defaults — used when a tenant has never written its own row (§10's "effective = tenant
 * override ?? system default"). `[]` business hours reads as "no restriction configured", the
 * same meaning an absent row has today (there was never a hard requirement to configure this).
 * `DEFAULT_TIMEZONE` is exported so AuthService (F18-01, `timezone` on `GET /auth/me`) resolves
 * exactly the same default a missing `tenant_settings` row would produce here — never a second,
 * potentially-drifting `'UTC'` literal. */
export const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_BUSINESS_HOURS: BusinessHoursEntryDto[] = [];

function toResponse(row: TenantSettingsRow | undefined): TenantSettingsResponseDto {
  if (!row) {
    return { timezone: DEFAULT_TIMEZONE, businessHours: DEFAULT_BUSINESS_HOURS, updatedAt: null };
  }
  return {
    timezone: row.timezone,
    businessHours: row.businessHours as BusinessHoursEntryDto[],
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateBusinessHours(entries: BusinessHoursEntryDto[]): void {
  const seenDays = new Set<number>();
  for (const entry of entries) {
    if (seenDays.has(entry.dayOfWeek)) {
      throw new BadRequestException(`businessHours has more than one entry for dayOfWeek ${entry.dayOfWeek}.`);
    }
    seenDays.add(entry.dayOfWeek);

    if (entry.isClosed) {
      continue;
    }
    // DTO-level @Matches already guarantees both are present and "HH:mm"-shaped when not closed —
    // this is the one cross-field check that can't be expressed per-field: zero-padded 24h times
    // compare correctly as plain strings, so no time-parsing library is needed for open < close.
    if (!entry.opensAt || !entry.closesAt || entry.opensAt >= entry.closesAt) {
      throw new BadRequestException(`businessHours entry for dayOfWeek ${entry.dayOfWeek} must have opensAt before closesAt.`);
    }
  }
}

/**
 * Tenant-scoped configuration (modules.md#administration, §7-§10 of this phase). Every method
 * takes an already-resolved `tenantId` (CurrentTenant — never client input) and runs inside
 * `withTenantTransaction`, so RLS backstops the tenant filter here exactly as it does for CORE's
 * TenantService, which this module deliberately mirrors rather than duplicates (§6).
 */
@Injectable()
export class TenantSettingsService {
  private readonly logger = new Logger(TenantSettingsService.name);

  constructor(
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getEffective(tenantId: string): Promise<TenantSettingsResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const row = await this.tenantSettingsRepository.find(tx, tenantId);
      return toResponse(row);
    });
  }

  async update(tenantId: string, dto: UpdateTenantSettingsDto, meta: AuditMeta): Promise<TenantSettingsResponseDto> {
    if (dto.businessHours) {
      validateBusinessHours(dto.businessHours);
    }

    return withTenantTransaction(tenantId, async (tx) => {
      const before = toResponse(await this.tenantSettingsRepository.find(tx, tenantId));

      const nextTimezone = dto.timezone ?? before.timezone;
      const nextBusinessHours = dto.businessHours ?? before.businessHours;

      const updated = await this.tenantSettingsRepository.upsert(tx, tenantId, {
        timezone: nextTimezone,
        businessHours: nextBusinessHours,
      });

      try {
        await this.auditLogService.record(tx, {
          tenantId,
          actorId: meta.actorId,
          actionCode: 'tenant_settings.updated',
          entityType: 'tenant_settings',
          entityId: updated.id,
          beforeState: { timezone: before.timezone, businessHours: before.businessHours },
          afterState: { timezone: nextTimezone, businessHours: nextBusinessHours },
          correlationId: meta.correlationId,
          ipAddress: meta.ipAddress,
        });
      } catch (error) {
        // Same posture as TenantService.updateCurrent — the write itself already succeeded; an
        // audit-write failure is logged, not surfaced as a failed request.
        this.logger.error(`Failed to write audit log for tenant_settings.updated (${tenantId}): ${String(error)}`);
      }

      return toResponse(updated);
    });
  }
}
