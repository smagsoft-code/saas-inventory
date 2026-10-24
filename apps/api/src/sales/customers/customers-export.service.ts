import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS, TRUNCATED_NOTE, TabularExportService, type TabularExportSpec } from '../../common/export/tabular-export.service';
import { CustomersService } from './customers.service';
import type { ExportCustomersQueryDto } from './dto/export-customers-query.dto';
import type { ListCustomersQueryDto } from './dto/list-customers-query.dto';

const TYPE_LABELS: Record<string, string> = { cedula: 'Cédula', ruc: 'RUC', pasaporte: 'Pasaporte' };

/** Clientes export — the same columns as the screen, over `CustomersService.list` (same `q` search). */
@Injectable()
export class CustomersExportService {
  constructor(
    private readonly customersService: CustomersService,
    private readonly tabularExportService: TabularExportService,
  ) {}

  async build(tenantId: string, query: ExportCustomersQueryDto): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const result = await this.customersService.list(tenantId, { ...query, page: 1, pageSize: EXPORT_MAX_ROWS } as ListCustomersQueryDto);
    const truncated = result.meta.total > result.data.length;
    const spec: TabularExportSpec = {
      title: 'Clientes',
      sheetName: 'Clientes',
      subtitle: [query.q ? `Búsqueda: ${query.q}` : 'Todos los clientes', `${result.meta.total} cliente(s)${truncated ? ` — se exportan ${result.data.length}` : ''}`],
      columns: [
        { header: 'Nombre', weight: 2 },
        { header: 'Tipo', weight: 0.9 },
        { header: 'Cédula/Ruc', weight: 1.2 },
        { header: 'Correo', weight: 2 },
        { header: 'Teléfono', weight: 1.2 },
      ],
      rows: result.data.map((c) => [c.displayName, TYPE_LABELS[c.type] ?? c.type, c.taxId ?? '', c.email ?? '', c.phone ?? '']),
      truncatedNote: truncated ? TRUNCATED_NOTE : undefined,
    };
    return this.tabularExportService.build(spec, query.format, 'clientes');
  }
}
