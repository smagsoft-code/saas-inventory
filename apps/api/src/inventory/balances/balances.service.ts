import { Injectable, NotFoundException } from '@nestjs/common';
import type { PaginatedResult } from '@saas-inventory/types';
import { withTenantTransaction } from '../../database/tenant-context';
import type { InventoryBalanceRow } from '../repositories/inventory-balances.repository';
import { InventoryBalancesRepository } from '../repositories/inventory-balances.repository';
import type { BalanceResponseDto } from './dto/balance-response.dto';
import type { ListBalancesQueryDto } from './dto/list-balances-query.dto';

function toResponse(balance: InventoryBalanceRow): BalanceResponseDto {
  return {
    id: balance.id,
    productVariantId: balance.productVariantId,
    locationId: balance.locationId,
    quantityPhysical: Number(balance.quantityPhysical),
    quantityReserved: Number(balance.quantityReserved),
    quantityCommitted: Number(balance.quantityCommitted),
    quantityAvailable: Number(balance.quantityAvailable ?? 0),
    version: balance.version,
    updatedAt: balance.updatedAt.toISOString(),
  };
}

/**
 * Read-only access to `inventory_balances` within the caller's own tenant — the MATERIALIZED READ
 * MODEL side of database.md#inventory-warehouses-locations-balance-ledger. Every write to a balance
 * happens exclusively through StockLedgerService (adjustments/transfers), never here.
 */
@Injectable()
export class BalancesService {
  constructor(private readonly balancesRepository: InventoryBalancesRepository) {}

  async list(tenantId: string, query: ListBalancesQueryDto): Promise<PaginatedResult<BalanceResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.balancesRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        productVariantId: query.productVariantId,
        locationId: query.locationId,
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

  async getById(tenantId: string, balanceId: string): Promise<BalanceResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const balance = await this.balancesRepository.findById(tx, tenantId, balanceId);
      if (!balance) {
        throw new NotFoundException('Balance not found.');
      }
      return toResponse(balance);
    });
  }
}
