import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { AuditMeta } from '../inventory-audit-meta';
import { LocationsRepository } from '../repositories/locations.repository';
import type { WarehouseRow } from '../repositories/warehouses.repository';
import { WarehousesRepository } from '../repositories/warehouses.repository';
import type { CreateWarehouseDto } from './dto/create-warehouse.dto';
import type { ListWarehousesQueryDto } from './dto/list-warehouses-query.dto';
import type { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import type { WarehouseResponseDto } from './dto/warehouse-response.dto';

const DEFAULT_LOCATION_NAME = 'General';
const DEFAULT_LOCATION_CODE = 'GENERAL';

interface UniqueViolation {
  code: string;
}

function hasUniqueViolationCode(error: unknown): error is UniqueViolation {
  return typeof error === 'object' && error !== null && 'code' in error && (error as UniqueViolation).code === '23505';
}

/** drizzle-orm's postgres-js driver wraps the real Postgres error (carrying `.code`) as
 * `DrizzleQueryError.cause`, never on the thrown error directly — same fix as
 * catalog/categories/categories.service.ts's isUniqueViolation. */
function isUniqueViolation(error: unknown): boolean {
  if (hasUniqueViolationCode(error)) {
    return true;
  }
  return error instanceof Error && hasUniqueViolationCode(error.cause);
}

function toResponse(warehouse: WarehouseRow): WarehouseResponseDto {
  return {
    id: warehouse.id,
    name: warehouse.name,
    code: warehouse.code,
    address: (warehouse.address as Record<string, unknown> | null) ?? undefined,
    status: warehouse.status,
    createdAt: warehouse.createdAt.toISOString(),
  };
}

/**
 * Warehouses within the caller's own tenant. Every method runs inside `withTenantTransaction`, so
 * RLS backstops every query here on top of the explicit tenantId filter, same convention as
 * catalog/categories/categories.service.ts. Creating a warehouse always creates its default
 * "General" location in the same transaction — database.md#inventory-warehouses-locations-balance-ledger's
 * "every warehouse always has at least one location, created automatically alongside it" invariant,
 * which is what keeps `inventory_balances.location_id` safely NOT NULL.
 */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly warehousesRepository: WarehousesRepository,
    private readonly locationsRepository: LocationsRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(tenantId: string, query: ListWarehousesQueryDto): Promise<PaginatedResult<WarehouseResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.warehousesRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
      });
      return {
        data: rows.map(toResponse),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
      };
    });
  }

  async getById(tenantId: string, warehouseId: string): Promise<WarehouseResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const warehouse = await this.warehousesRepository.findById(tx, tenantId, warehouseId);
      if (!warehouse) {
        throw new NotFoundException('Warehouse not found.');
      }
      return toResponse(warehouse);
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateWarehouseDto, meta: AuditMeta): Promise<WarehouseResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      let created: WarehouseRow;
      try {
        created = await this.warehousesRepository.create(tx, {
          id: generateId(),
          tenantId,
          name: dto.name,
          code: dto.code,
          address: dto.address,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A warehouse with this code already exists.');
        }
        throw error;
      }

      const defaultLocation = await this.locationsRepository.create(tx, {
        id: generateId(),
        tenantId,
        warehouseId: created.id,
        name: DEFAULT_LOCATION_NAME,
        code: DEFAULT_LOCATION_CODE,
      });

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'warehouse.created',
        entityId: created.id,
        afterState: { name: created.name, code: created.code, defaultLocationId: defaultLocation.id },
        meta,
      });

      return toResponse(created);
    });
  }

  async update(
    tenantId: string,
    actorId: string,
    warehouseId: string,
    dto: UpdateWarehouseDto,
    meta: AuditMeta,
  ): Promise<WarehouseResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const before = await this.warehousesRepository.findById(tx, tenantId, warehouseId);
      if (!before) {
        throw new NotFoundException('Warehouse not found.');
      }

      let updated: WarehouseRow | undefined;
      try {
        updated = await this.warehousesRepository.update(tx, tenantId, warehouseId, {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A warehouse with this code already exists.');
        }
        throw error;
      }
      if (!updated) {
        throw new NotFoundException('Warehouse not found.');
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'warehouse.updated',
        entityId: warehouseId,
        beforeState: { name: before.name, code: before.code, status: before.status },
        afterState: { name: updated.name, code: updated.code, status: updated.status },
        meta,
      });

      return toResponse(updated);
    });
  }

  private async writeAudit(
    tx: TenantTransaction,
    input: {
      tenantId: string;
      actorId: string;
      actionCode: string;
      entityId: string;
      beforeState?: Record<string, unknown>;
      afterState?: Record<string, unknown>;
      meta: AuditMeta;
    },
  ): Promise<void> {
    try {
      await this.auditLogService.record(tx, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        actionCode: input.actionCode,
        entityType: 'warehouse',
        entityId: input.entityId,
        beforeState: input.beforeState,
        afterState: input.afterState,
        correlationId: input.meta.correlationId,
        ipAddress: input.meta.ipAddress,
      });
    } catch {
      // Best-effort — an audit write failure must never block the primary operation, same
      // convention as catalog/categories/categories.service.ts's writeAudit().
    }
  }
}
