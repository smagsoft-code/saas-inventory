import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { withTenantTransaction } from '../../database/tenant-context';
import { importFieldLabel } from '../import-fields';
import { ImportFileStorage } from './import-file.service';
import { ImportJobRowsRepository } from '../repositories/import-job-rows.repository';
import { ImportJobsRepository } from '../repositories/import-jobs.repository';

const FORMULA_LEADING_CHARS = new Set(['=', '+', '-', '@']);

/** §15/security.md#file-upload-security — neutralizes the classic CSV/Excel formula-injection
 * leading characters before a value is ever echoed back into a generated spreadsheet. A leading
 * single quote makes Excel/LibreOffice/Sheets render the cell as inert text, never a formula. */
export function sanitizeForSpreadsheet(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return text.length > 0 && FORMULA_LEADING_CHARS.has(text[0]!) ? `'${text}` : text;
}

/** The Excel header the user's file uses for a target field (reverse lookup of `columnMapping`,
 * which is `{ "<Excel header>": "<field>" }`), or `''` when no column was mapped to it (e.g. the
 * location comes from the job default). */
export function headerForField(columnMapping: Record<string, string> | null | undefined, field: string): string {
  for (const [header, target] of Object.entries(columnMapping ?? {})) {
    if (target === field) return header;
  }
  return '';
}

/**
 * §15 — one row per `invalid` (and, optionally, `warning`) row, identifying the row, the offending
 * field, the error code/message/severity, and (sanitized) the relevant submitted value. Generated
 * on demand from the current row state — bounded by the same IMPORT_MAX_ROWS every file already
 * respects, so it never needs streaming/object-storage-backed generation the way the uploaded file
 * itself does; still written through ObjectStorageService (ImportFileStorage) rather than returned
 * as one giant in-memory response body, per §15's "no cargar archivos enormes completamente en
 * memoria" applied to the round trip as a whole.
 */
@Injectable()
export class ImportErrorReportService {
  constructor(
    private readonly importJobsRepository: ImportJobsRepository,
    private readonly importJobRowsRepository: ImportJobRowsRepository,
    private readonly fileStorage: ImportFileStorage,
  ) {}

  async generate(tenantId: string, jobId: string, includeWarnings: boolean): Promise<Buffer> {
    const rows = await withTenantTransaction(tenantId, async (tx) => {
      const job = await this.importJobsRepository.findById(tx, tenantId, jobId);
      if (!job) throw new NotFoundException('Import job not found.');

      const columnMapping = (job.columnMapping ?? {}) as Record<string, string>;
      const collected: Array<{ rowNumber: number; field: string; column: string; code: string; message: string; severity: 'error' | 'warning'; value: unknown }> = [];
      const entryFor = (row: { rowNumber: number; rawData: unknown; mappedData: unknown }, issue: { field: string; code: string; message: string }, severity: 'error' | 'warning') => {
        const column = headerForField(columnMapping, issue.field);
        const raw = (row.rawData as Record<string, unknown> | null) ?? {};
        const mapped = (row.mappedData as Record<string, unknown> | null) ?? {};
        return { rowNumber: row.rowNumber, field: importFieldLabel(issue.field), column, code: issue.code, message: issue.message, severity, value: column && column in raw ? raw[column] : mapped[issue.field] };
      };
      let page = 1;
      const pageSize = 500;
      for (;;) {
        const { rows: batch, total } = await this.importJobRowsRepository.listByJob(tx, tenantId, jobId, { page, pageSize, status: 'invalid' });
        for (const row of batch) {
          for (const error of row.errors) {
            collected.push(entryFor(row, error, 'error'));
          }
        }
        if (page * pageSize >= total) break;
        page += 1;
      }

      if (includeWarnings) {
        page = 1;
        for (;;) {
          const { rows: batch, total } = await this.importJobRowsRepository.listByJob(tx, tenantId, jobId, { page, pageSize, status: 'warning' });
          for (const row of batch) {
            for (const warning of row.warnings) {
              collected.push(entryFor(row, warning, 'warning'));
            }
          }
          if (page * pageSize >= total) break;
          page += 1;
        }
      }

      return collected;
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Errores');
    sheet.columns = [
      { header: 'Fila (del Excel)', key: 'rowNumber', width: 16 },
      { header: 'Columna en tu archivo', key: 'column', width: 26 },
      { header: 'Campo', key: 'field', width: 24 },
      { header: 'Tipo', key: 'severity', width: 14 },
      { header: 'Qué está mal', key: 'message', width: 70 },
      { header: 'Valor recibido', key: 'value', width: 30 },
      { header: 'Código de error', key: 'code', width: 30 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const entry of rows.sort((a, b) => a.rowNumber - b.rowNumber)) {
      sheet.addRow({
        rowNumber: entry.rowNumber,
        column: sanitizeForSpreadsheet(entry.column),
        field: sanitizeForSpreadsheet(entry.field),
        code: sanitizeForSpreadsheet(entry.code),
        severity: entry.severity === 'error' ? 'Error' : 'Advertencia',
        message: sanitizeForSpreadsheet(entry.message),
        value: sanitizeForSpreadsheet(entry.value),
      });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const storageKey = await this.fileStorage.storeErrorReport(tenantId, jobId, buffer);
    await withTenantTransaction(tenantId, (tx) => this.importJobsRepository.update(tx, tenantId, jobId, { errorReportStorageKey: storageKey }));
    return buffer;
  }
}
