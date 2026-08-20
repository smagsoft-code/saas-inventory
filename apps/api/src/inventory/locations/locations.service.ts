import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { AuditMeta } from '../inventory-audit-meta';
import type { LocationRow } from '../repositories/locations.repository';
import { LocationsRepository } from '../repositories/locations.repository';
import { WarehousesRepository } from '../repositories/warehouses.repository';
import type { CreateLocationDto } from './dto/create-location.dto';
import type { ListLocationsQueryDto } from './dto/list-locations-query.dto';
import type { LocationResponseDto } from './dto/location-response.dto';
import type { UpdateLocationDto } from './dto/update-location.dto';

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

function toResponse(location: LocationRow): LocationResponseDto {
  return {
    id: location.id,
    warehouseId: location.warehouseId,
    parentLocationId: location.parentLocationId ?? undefined,
    name: location.name,
    code: location.code,
    isSellable: location.isSellable,
    status: location.status,
    createdAt: location.createdAt.toISOString(),
  };
}

/**
 * Locations (a hierarchy under a warehouse — modules.md#inventory-and-locations-summary) within the
 * caller's own tenant. Every method runs inside `withTenantTransaction`, same convention as
 * catalog/categories/categories.service.ts. Reparenting is only ever validated against the
 * location's own warehouse — moving a location to a different warehouse entirely is out of this
 * endpoint's scope (see update-location.dto.ts).
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly locationsRepository: LocationsRepository,
    private readonly warehousesRepository: WarehousesRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(tenantId: string, query: ListLocationsQueryDto): Promise<PaginatedResult<LocationResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.locationsRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        warehouseId: query.warehouseId,
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

  async getById(tenantId: string, locationId: string): Promise<LocationResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const location = await this.locationsRepository.findById(tx, tenantId, locationId);
      if (!location) {
        throw new NotFoundException('Location not found.');
      }
      return toResponse(location);
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateLocationDto, meta: AuditMeta): Promise<LocationResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const warehouse = await this.warehousesRepository.findById(tx, tenantId, dto.warehouseId);
      if (!warehouse) {
        throw new NotFoundException('Warehouse not found.');
      }

      if (dto.parentLocationId) {
        const parent = await this.locationsRepository.findById(tx, tenantId, dto.parentLocationId);
        if (!parent) {
          throw new NotFoundException('Parent location not found.');
        }
        if (parent.warehouseId !== dto.warehouseId) {
          throw new BadRequestException('Parent location must belong to the same warehouse.');
        }
      }

      let created: LocationRow;
      try {
        created = await this.locationsRepository.create(tx, {
          id: generateId(),
          tenantId,
          warehouseId: dto.warehouseId,
          parentLocationId: dto.parentLocationId,
          name: dto.name,
          code: dto.code,
          isSellable: dto.isSellable,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A location with this code already exists in this warehouse.');
        }
        throw error;
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'location.created',
        entityId: created.id,
        afterState: { warehouseId: created.warehouseId, parentLocationId: created.parentLocationId, name: created.name, code: created.code },
        meta,
      });

      return toResponse(created);
    });
  }

  async update(
    tenantId: string,
    actorId: string,
    locationId: string,
    dto: UpdateLocationDto,
    meta: AuditMeta,
  ): Promise<LocationResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const before = await this.locationsRepository.findById(tx, tenantId, locationId);
      if (!before) {
        throw new NotFoundException('Location not found.');
      }

      if (dto.parentLocationId !== undefined) {
        if (dto.parentLocationId === locationId) {
          throw new BadRequestException('A location cannot be its own parent.');
        }
        const parent = await this.locationsRepository.findById(tx, tenantId, dto.parentLocationId);
        if (!parent) {
          throw new NotFoundException('Parent location not found.');
        }
        if (parent.warehouseId !== before.warehouseId) {
          throw new BadRequestException('Parent location must belong to the same warehouse.');
        }
      }

      let updated: LocationRow | undefined;
      try {
        updated = await this.locationsRepository.update(tx, tenantId, locationId, {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.parentLocationId !== undefined ? { parentLocationId: dto.parentLocationId } : {}),
          ...(dto.isSellable !== undefined ? { isSellable: dto.isSellable } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A location with this code already exists in this warehouse.');
        }
        throw error;
      }
      if (!updated) {
        throw new NotFoundException('Location not found.');
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'location.updated',
        entityId: locationId,
        beforeState: { name: before.name, code: before.code, isSellable: before.isSellable, status: before.status },
        afterState: { name: updated.name, code: updated.code, isSellable: updated.isSellable, status: updated.status },
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
        entityType: 'location',
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
