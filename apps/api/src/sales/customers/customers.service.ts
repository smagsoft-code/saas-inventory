import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { AuditMeta } from '../sales-audit-meta';
import type { CustomerRow } from '../repositories/customers.repository';
import { CustomersRepository } from '../repositories/customers.repository';
import type { CreateCustomerDto } from './dto/create-customer.dto';
import type { CustomerResponseDto } from './dto/customer-response.dto';
import type { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import type { UpdateCustomerDto } from './dto/update-customer.dto';

function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown): string | undefined =>
    typeof value === 'object' && value !== null && 'code' in value ? (value as { code?: string }).code : undefined;
  return code(error) === '23505' || (error instanceof Error && code(error.cause) === '23505');
}

/** "juan PÉREZ  gómez" → "Juan Pérez Gómez": every word starts upper-case, the rest lower-case, spaces collapsed. */
export function standardizeName<T extends string | undefined>(value: T): T {
  if (value === undefined) return value;
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toLocaleUpperCase('es') + word.slice(1).toLocaleLowerCase('es'))
    .join(' ') as T;
}

function toResponse(row: CustomerRow): CustomerResponseDto {
  return {
    id: row.id,
    type: row.type,
    firstName: row.firstName,
    ...(row.lastName ? { lastName: row.lastName } : {}),
    displayName: row.displayName,
    ...(row.taxId ? { taxId: row.taxId } : {}),
    ...(row.email ? { email: row.email } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.address ? { address: row.address } : {}),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Customers within the caller's own tenant (§8-§12). Every method runs inside
 * `withTenantTransaction`, so RLS backstops every query on top of the explicit tenantId filter.
 * `tenant_id` is always CurrentTenant — never taken from the request (§9). Identification (`taxId`)
 * uniqueness is per-tenant (`customers_tenant_id_tax_id_key`), enforced by the DB and surfaced as a
 * clean 409 here (§10). No physical delete (§11) — `customers` is soft-deleted and historical
 * orders still reference it.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(tenantId: string, query: ListCustomersQueryDto): Promise<PaginatedResult<CustomerResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.customersRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        type: query.type,
        q: query.q,
      });
      return {
        data: rows.map(toResponse),
        meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      };
    });
  }

  async getById(tenantId: string, id: string): Promise<CustomerResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const row = await this.customersRepository.findById(tx, tenantId, id);
      if (!row) {
        throw new NotFoundException('Customer not found.');
      }
      return toResponse(row);
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateCustomerDto, meta: AuditMeta): Promise<CustomerResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      let row: CustomerRow;
      try {
        row = await this.customersRepository.create(tx, {
          id: generateId(),
          tenantId,
          type: dto.type,
          firstName: standardizeName(dto.firstName),
          lastName: standardizeName(dto.lastName),
          taxId: dto.taxId,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          address: dto.address ?? null,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A customer with this tax id already exists in this tenant.');
        }
        throw error;
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'customer.created',
        entityId: row.id,
        afterState: { displayName: row.displayName, type: row.type, taxId: row.taxId },
        meta,
      });

      return toResponse(row);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateCustomerDto, meta: AuditMeta): Promise<CustomerResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const before = await this.customersRepository.findById(tx, tenantId, id);
      if (!before) {
        throw new NotFoundException('Customer not found.');
      }

      let updated: CustomerRow | undefined;
      try {
        updated = await this.customersRepository.update(tx, tenantId, id, {
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.firstName !== undefined ? { firstName: standardizeName(dto.firstName) } : {}),
          ...(dto.lastName !== undefined ? { lastName: standardizeName(dto.lastName) } : {}),
          ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A customer with this tax id already exists in this tenant.');
        }
        throw error;
      }
      if (!updated) {
        throw new NotFoundException('Customer not found.');
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'customer.updated',
        entityId: id,
        beforeState: { displayName: before.displayName, email: before.email, phone: before.phone, taxId: before.taxId, status: before.status },
        afterState: { displayName: updated.displayName, email: updated.email, phone: updated.phone, taxId: updated.taxId, status: updated.status },
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
        entityType: 'customer',
        entityId: input.entityId,
        beforeState: input.beforeState,
        afterState: input.afterState,
        correlationId: input.meta.correlationId,
        ipAddress: input.meta.ipAddress,
      });
    } catch {
      // Best-effort — an audit write failure must never block the primary operation.
    }
  }
}
