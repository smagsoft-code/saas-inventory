import { Injectable } from '@nestjs/common';
import { loadLocationLabels } from '../../common/export/location-labels';
import { EXPORT_MAX_ROWS, TRUNCATED_NOTE, TabularExportService, type TabularExportSpec } from '../../common/export/tabular-export.service';
import type { ExportTransfersQueryDto } from './dto/export-transfers-query.dto';
import type { ListTransfersQueryDto } from './dto/list-transfers-query.dto';
import { TransfersService } from './transfers.service';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  approved: 'Aprobada',
  preparing: 'En preparación',
  dispatched: 'Despachada',
  partially_received: 'Recibida parcialmente',
  received: 'Recibida',
  cancelled: 'Cancelada',
};

/** Transferencias export — the screen's columns over `TransfersService.list` (same filters). */
@Injectable()
export class TransfersExportService {
  constructor(
    private readonly transfersService: TransfersService,
    private readonly tabularExportService: TabularExportService,
  ) {}

  async build(tenantId: string, query: ExportTransfersQueryDto): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const result = await this.transfersService.list(tenantId, { ...query, page: 1, pageSize: EXPORT_MAX_ROWS } as ListTransfersQueryDto);
    const labels = await loadLocationLabels(
      tenantId,
      result.data.flatMap((t) => [t.sourceLocationId, t.destinationLocationId]),
    );
    const truncated = result.meta.total > result.data.length;
    const filters = [
      query.status ? `Estado: ${STATUS_LABELS[query.status] ?? query.status}` : undefined,
      query.sourceLocationId ? 'Origen filtrado' : undefined,
      query.destinationLocationId ? 'Destino filtrado' : undefined,
    ].filter(Boolean);
    const spec: TabularExportSpec = {
      title: 'Transferencias',
      sheetName: 'Transferencias',
      subtitle: [filters.length > 0 ? filters.join(' · ') : 'Todas las transferencias', `${result.meta.total} transferencia(s)${truncated ? ` — se exportan ${result.data.length}` : ''}`],
      columns: [
        { header: 'Transferencia', weight: 1.2 },
        { header: 'Estado', weight: 1.2 },
        { header: 'Origen', weight: 2 },
        { header: 'Destino', weight: 2 },
        { header: 'Líneas', align: 'right', weight: 0.7, format: 'integer' },
        { header: 'En tránsito', align: 'right', weight: 0.9, format: 'integer' },
        { header: 'Creada', weight: 1 },
      ],
      rows: result.data.map((t) => [
        t.code,
        STATUS_LABELS[t.status] ?? t.status,
        labels.get(t.sourceLocationId) ?? '',
        labels.get(t.destinationLocationId) ?? '',
        t.items.length,
        t.items.reduce((sum, item) => sum + item.quantityInTransit, 0),
        new Date(t.createdAt).toLocaleDateString('es'),
      ]),
      truncatedNote: truncated ? TRUNCATED_NOTE : undefined,
    };
    return this.tabularExportService.build(spec, query.format, 'transferencias');
  }
}
