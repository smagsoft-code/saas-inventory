import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface TabularColumn {
  header: string;
  /** Numbers/amounts line up on the right. */
  align?: 'left' | 'right';
  /** Relative width in the PDF (default 1). */
  weight?: number;
  /** How a numeric cell is shown: `money` = 2 decimals (default), `integer` = a plain count. */
  format?: 'money' | 'integer';
}

export interface TabularExportSpec {
  title: string;
  sheetName: string;
  /** Short context lines under the title (period, filters, totals). */
  subtitle: string[];
  columns: TabularColumn[];
  rows: Array<Array<string | number>>;
  footnotes?: string[];
  /** The result was cut at the export cap — said in the file, never silently. */
  truncatedNote?: string | undefined;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PDF_MIME = 'application/pdf';

const MONEY = new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cellText(value: string | number, column: TabularColumn | undefined): string {
  if (typeof value !== 'number') return value;
  return column?.format === 'integer' ? String(value) : MONEY.format(value);
}

/**
 * One generic table → Excel / PDF builder shared by every list export (Historial de ventas,
 * Transferencias, Clientes). Each domain builds the same rows the screen shows (same filters, same
 * order) and hands them over as a `TabularExportSpec` — this class owns only the file formats. Same
 * libraries and look as the Kardex / Formas de pago exports (`exceljs`, `pdfkit`).
 */
@Injectable()
export class TabularExportService {
  async buildXlsx(spec: TabularExportSpec): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'saas-inventory';
    const sheet = workbook.addWorksheet(spec.sheetName);

    sheet.addRow([spec.title]);
    for (const line of spec.subtitle) sheet.addRow([line]);
    sheet.addRow([`Generado: ${new Date().toLocaleString('es')}`]);
    sheet.addRow([]);
    sheet.getRow(1).font = { bold: true, size: 14 };

    sheet.addRow(spec.columns.map((c) => c.header)).font = { bold: true };
    for (const row of spec.rows) {
      const added = sheet.addRow(row);
      spec.columns.forEach((column, index) => {
        const cell = added.getCell(index + 1);
        if (typeof row[index] === 'number') cell.numFmt = column.format === 'integer' ? '0' : '#,##0.00';
        if (column.align === 'right') cell.alignment = { horizontal: 'right' };
      });
    }
    if (spec.footnotes?.length || spec.truncatedNote) {
      sheet.addRow([]);
      for (const note of spec.footnotes ?? []) sheet.addRow([note]);
      if (spec.truncatedNote) sheet.addRow([spec.truncatedNote]);
    }
    sheet.columns.forEach((column) => {
      column.width = 22;
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async buildPdf(spec: TabularExportSpec): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text(spec.title);
      doc.fontSize(10);
      for (const line of spec.subtitle) doc.text(line);
      doc.text(`Generado: ${new Date().toLocaleString('es')}`);
      doc.moveDown();

      const left = doc.page.margins.left;
      const usable = doc.page.width - left - doc.page.margins.right;
      const weights = spec.columns.map((c) => c.weight ?? 1);
      const weightSum = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => (w / weightSum) * usable - 4);
      const offsets = widths.map((_, i) => left + widths.slice(0, i).reduce((a, b) => a + b + 4, 0));

      const drawRow = (values: string[], bold: boolean): void => {
        if (doc.y + 14 > doc.page.height - doc.page.margins.bottom) doc.addPage();
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#000000');
        const y = doc.y;
        values.forEach((value, index) => {
          doc.text(value, offsets[index] ?? left, y, {
            width: widths[index] ?? 60,
            ellipsis: true,
            lineBreak: false,
            align: spec.columns[index]?.align === 'right' ? 'right' : 'left',
          });
        });
        doc.y = y + 13;
      };

      drawRow(
        spec.columns.map((c) => c.header),
        true,
      );
      for (const row of spec.rows) drawRow(row.map((value, index) => cellText(value, spec.columns[index])), false);

      if (spec.footnotes?.length || spec.truncatedNote) {
        doc.moveDown();
        doc.font('Helvetica-Oblique').fontSize(8);
        for (const note of spec.footnotes ?? []) doc.text(note, left);
        if (spec.truncatedNote) doc.text(spec.truncatedNote, left);
      }
      doc.end();
    });
  }

  /** Builds the requested format and the matching download headers' values. */
  async build(spec: TabularExportSpec, format: 'xlsx' | 'pdf', baseName: string): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    if (format === 'xlsx') {
      return { buffer: await this.buildXlsx(spec), contentType: XLSX_MIME, filename: `${baseName}.xlsx` };
    }
    return { buffer: await this.buildPdf(spec), contentType: PDF_MIME, filename: `${baseName}.pdf` };
  }
}

export const EXPORT_FORMATS = ['xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
/** Hard cap of every list export — the file says so when the filtered set is bigger. */
export const EXPORT_MAX_ROWS = 2000;
export const TRUNCATED_NOTE = `El resultado excedió el límite de ${EXPORT_MAX_ROWS} filas — acota los filtros para ver el resto.`;
