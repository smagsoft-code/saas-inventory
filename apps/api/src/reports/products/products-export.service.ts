import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { EXPORT_MAX_ROWS, TRUNCATED_NOTE, TabularExportService, type TabularExportSpec } from '../../common/export/tabular-export.service';
import { withTenantTransaction } from '../../database/tenant-context';
import type { ProductCatalogExportQueryDto } from './dto/product-catalog-export-query.dto';
import { ProductsReportService } from './products-report.service';

const STATUS_LABELS: Record<string, string> = { active: 'Activo', discontinued: 'Desactivado' };
const STOCK_LABELS: Record<string, string> = { with: 'Con stock', without: 'Sin stock', available: 'Disponible' };

/** Productos export — the screen's columns over the very same `listCatalog` read (same filters,
 * same variant grain: one row per variant), with category names resolved in one batched query. */
@Injectable()
export class ProductsExportService {
  constructor(
    private readonly productsReportService: ProductsReportService,
    private readonly tabularExportService: TabularExportService,
  ) {}

  async build(tenantId: string, query: ProductCatalogExportQueryDto): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const result = await this.productsReportService.listCatalog(tenantId, { ...query, page: 1, pageSize: EXPORT_MAX_ROWS });
    const categoryIds = [...new Set(result.data.map((r) => r.categoryId).filter((id): id is string => Boolean(id)))];
    const categoryNames = new Map<string, string>();
    if (categoryIds.length > 0) {
      await withTenantTransaction(tenantId, async (tx) => {
        const rows = await tx.execute<{ id: string; name: string }>(
          sql`select id as "id", name as "name" from categories where tenant_id = ${tenantId} and id in (${sql.join(categoryIds.map((id) => sql`${id}`), sql`, `)})`,
        );
        for (const row of rows) categoryNames.set(row.id, row.name);
      });
    }
    const truncated = result.meta.total > result.data.length;
    const filters = [
      query.q ? `Búsqueda: ${query.q}` : undefined,
      query.categoryId ? `Categoría: ${categoryNames.get(query.categoryId) ?? 'filtrada'}` : undefined,
      query.status ? `Estado: ${STATUS_LABELS[query.status] ?? query.status}` : undefined,
      query.stock ? `Stock: ${STOCK_LABELS[query.stock] ?? query.stock}` : undefined,
    ].filter(Boolean);

    const spec: TabularExportSpec = {
      title: 'Productos',
      sheetName: 'Productos',
      subtitle: [filters.length > 0 ? filters.join(' · ') : 'Todos los productos', `${result.meta.total} variante(s)${truncated ? ` — se exportan ${result.data.length}` : ''}`],
      columns: [
        { header: 'Nombre', weight: 2.2 },
        { header: 'Categoría', weight: 1.4 },
        { header: 'Código', weight: 1.3 },
        { header: 'Stock', align: 'right', weight: 0.8, format: 'integer' },
        { header: 'Precio máx.', align: 'right', weight: 1 },
        { header: 'Precio base', align: 'right', weight: 1 },
        { header: 'Estado', weight: 1 },
      ],
      rows: result.data.map((r) => [
        r.productName,
        r.categoryId ? (categoryNames.get(r.categoryId) ?? '') : '',
        r.sku,
        r.availableQuantity,
        r.maxPrice,
        r.basePrice,
        STATUS_LABELS[r.status] ?? r.status,
      ]),
      truncatedNote: truncated ? TRUNCATED_NOTE : undefined,
    };
    return this.tabularExportService.build(spec, query.format, 'productos');
  }
}
