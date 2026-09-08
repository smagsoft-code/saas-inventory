import { Injectable } from '@nestjs/common';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type {
  TransfersDestinationBucketDto,
  TransfersStatusBucketDto,
  TransfersSummaryResponseDto,
  TransfersVariantBucketDto,
} from './dto/transfers-summary-response.dto';
import type { TransfersSummaryQueryDto } from './dto/transfers-summary-query.dto';
import type {
  TransfersDestinationBucketRow,
  TransfersStatusBucketRow,
  TransfersTotalsRow,
  TransfersVariantBucketRow,
} from './transfers-report.repository';
import { TransfersReportRepository } from './transfers-report.repository';

function toNumber(value: string): number {
  return Number(value);
}

/**
 * `GET /reports/transfers-summary` (F18-08 — "Transfer analytics"). A live aggregate over current
 * `inventory_transfers` / `inventory_transfer_items` state — never a stored snapshot
 * (`GAP-SNAPSHOTS` stays open), never a client-side fold over the paged transfer list (the pattern
 * this endpoint replaces — `REP-INV-INTRANSIT`, `TRF-INTRANSIT-QTY`, `TRF-OPEN-COUNT`).
 *
 * Deliberately does **not** use `inventory_movements` (`TRANSFER_OUT`/`TRANSFER_IN` rows): those are
 * the ledger side-effects of the dispatch/receive transitions, not the transfer's own state, and
 * the reporting docs are explicit that in-transit stock "is derived from open transfers, not a
 * stored balance bucket" (F18-07 also draws this exact line — "in-transit aggregation is
 * `GAP-INV-AGGREGATE`'s remainder, not [movements-summary]"). The `inventory_transfers` /
 * `inventory_transfer_items` tables carry the common identifier (`transfer_id`), origin/destination,
 * status and per-item dispatched/received quantities the metric formulas need.
 */
@Injectable()
export class TransfersReportService {
  constructor(private readonly transfersReportRepository: TransfersReportRepository) {}

  async getTransfersSummary(tenantId: string, query: TransfersSummaryQueryDto): Promise<TransfersSummaryResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const [totalsRow, buckets] = await Promise.all([
        this.transfersReportRepository.totals(tx, tenantId),
        this.loadBuckets(tx, tenantId, query.groupBy),
      ]);

      return {
        generatedAt: new Date().toISOString(),
        groupBy: query.groupBy,
        totals: toTotals(totalsRow),
        buckets,
      };
    });
  }

  private async loadBuckets(
    tx: TenantTransaction,
    tenantId: string,
    groupBy: TransfersSummaryQueryDto['groupBy'],
  ): Promise<TransfersSummaryResponseDto['buckets']> {
    if (groupBy === 'destination') {
      const rows = await this.transfersReportRepository.destinationBuckets(tx, tenantId);
      return rows.map(toDestinationBucket);
    }
    if (groupBy === 'variant') {
      const rows = await this.transfersReportRepository.variantBuckets(tx, tenantId);
      return rows.map(toVariantBucket);
    }
    const rows = await this.transfersReportRepository.statusBuckets(tx, tenantId);
    return rows.map(toStatusBucket);
  }
}

function toTotals(row: TransfersTotalsRow): TransfersSummaryResponseDto['totals'] {
  return {
    inTransitQuantity: toNumber(row.inTransitQuantity),
    openTransferCount: toNumber(row.openTransferCount),
  };
}

function toStatusBucket(row: TransfersStatusBucketRow): TransfersStatusBucketDto {
  return { key: row.key, transferCount: toNumber(row.transferCount) };
}

function toDestinationBucket(row: TransfersDestinationBucketRow): TransfersDestinationBucketDto {
  return {
    key: row.key,
    destinationName: row.destinationName,
    inTransitQuantity: toNumber(row.inTransitQuantity),
    openTransferCount: toNumber(row.openTransferCount),
  };
}

function toVariantBucket(row: TransfersVariantBucketRow): TransfersVariantBucketDto {
  return {
    key: row.key,
    sku: row.sku,
    productName: row.productName,
    inTransitQuantity: toNumber(row.inTransitQuantity),
  };
}
