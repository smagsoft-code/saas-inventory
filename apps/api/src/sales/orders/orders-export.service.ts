import { Injectable } from '@nestjs/common';
import { TenantSettingsRepository } from '../../administration/tenant-settings/tenant-settings.repository';
import { DEFAULT_TIMEZONE } from '../../administration/tenant-settings/tenant-settings.service';
import { loadLocationLabels } from '../../common/export/location-labels';
import { EXPORT_MAX_ROWS, TRUNCATED_NOTE, TabularExportService, type TabularExportSpec } from '../../common/export/tabular-export.service';
import { withTenantTransaction } from '../../database/tenant-context';
import type { ExportOrdersQueryDto } from './dto/export-orders-query.dto';
import type { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrdersService } from './orders.service';

const STATUS_LABELS: Record<string, string> = { draft: 'Borrador', pending: 'Pendiente', confirmed: 'Confirmado', fulfilled: 'Completado', cancelled: 'Cancelado' };
const DOCUMENT_LABELS: Record<string, string> = { invoice: 'Factura', sales_note: 'Nota de venta' };
const NOTIFICATION_LABELS: Record<string, string> = { none: 'Sin notificación', pending: 'En cola', delivered: 'Entregada', failed: 'Falló el envío' };

function dateTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('es', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString('es');
  }
}

/**
 * Historial de ventas export. Reuses `OrdersService.list` — so the filters, the seller scope
 * (`sales.orders.view_all`) and the location read scope are exactly the screen's, never a second
 * implementation — with the page forced to the first `EXPORT_MAX_ROWS` rows.
 */
@Injectable()
export class OrdersExportService {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly tabularExportService: TabularExportService,
  ) {}

  async build(tenantId: string, actorId: string, permissions: string[], query: ExportOrdersQueryDto): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const result = await this.ordersService.list(tenantId, actorId, permissions, { ...query, page: 1, pageSize: EXPORT_MAX_ROWS } as ListOrdersQueryDto);
    const [labels, timezone] = await Promise.all([
      loadLocationLabels(
        tenantId,
        result.data.map((o) => o.locationId),
      ),
      withTenantTransaction(tenantId, async (tx) => (await this.tenantSettingsRepository.find(tx, tenantId))?.timezone ?? DEFAULT_TIMEZONE),
    ]);
    const currency = result.data[0]?.currency ?? 'USD';
    const total = result.data.reduce((sum, o) => sum + o.total, 0);
    const truncated = result.meta.total > result.data.length;
    const period = query.dateFrom ? (query.dateTo && query.dateTo !== query.dateFrom ? `${query.dateFrom} – ${query.dateTo}` : query.dateFrom) : 'Todo el historial';

    const spec: TabularExportSpec = {
      title: 'Historial de ventas',
      sheetName: 'Historial de ventas',
      subtitle: [`Periodo: ${period}`, `${result.meta.total} pedido(s)${truncated ? ` — se exportan ${result.data.length}` : ` — suma de totales ${total.toFixed(2)} ${currency}`}`],
      columns: [
        { header: 'Pedido', weight: 1 },
        { header: 'Fecha', weight: 1.1 },
        { header: 'Cliente', weight: 1.6 },
        { header: 'Vendedor', weight: 1.3 },
        { header: 'Documento', weight: 1 },
        { header: 'Almacén', weight: 1.6 },
        { header: 'Estado', weight: 0.9 },
        { header: 'Notificación', weight: 1 },
        { header: `Total (${currency})`, align: 'right', weight: 1 },
      ],
      rows: result.data.map((o) => [
        o.orderNumber,
        dateTime(o.createdAt, timezone),
        o.customer.name,
        o.placedByName ?? '',
        DOCUMENT_LABELS[o.documentType] ?? o.documentType,
        labels.get(o.locationId) ?? '',
        STATUS_LABELS[o.status] ?? o.status,
        NOTIFICATION_LABELS[o.notificationStatus ?? 'none'] ?? '',
        o.total,
      ]),
      truncatedNote: truncated ? TRUNCATED_NOTE : undefined,
    };
    return this.tabularExportService.build(spec, query.format, 'historial-de-ventas');
  }
}
