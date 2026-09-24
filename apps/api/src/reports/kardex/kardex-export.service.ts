import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { KardexResponseDto } from './dto/kardex-response.dto';

export interface KardexExportContext {
  productName: string;
  sku: string;
  locationLabel: string;
  from: string | undefined;
  to: string | undefined;
  canViewCost: boolean;
}

const MONEY = new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(value: number | undefined): string {
  return value === undefined ? '' : MONEY.format(value);
}

function rangeLabel(context: KardexExportContext): string {
  if (!context.from && !context.to) return 'Todo el historial';
  const from = context.from ? new Date(context.from).toLocaleDateString('es') : '…';
  const to = context.to ? new Date(context.to).toLocaleDateString('es') : '…';
  return `${from} – ${to}`;
}

/**
 * Both formats are built from the exact same `KardexResponseDto` the screen renders — never a
 * separate unfiltered query — so the export always contains precisely the filtered set on screen
 * (UI-UX-SPEC-001 §19). `exceljs` was already a dependency (the import pipeline's template/error
 * report generation, `import-template.service.ts`); `pdfkit` is new — no PDF generation existed
 * anywhere in the codebase (see the FASE audit that preceded this feature) and it was chosen over a
 * headless-browser approach (e.g. puppeteer) specifically because it needs no Chromium and has no
 * native dependencies, the lightest option for a simple tabular report.
 */
@Injectable()
export class KardexExportService {
  async buildXlsx(data: KardexResponseDto, context: KardexExportContext): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'saas-inventory';
    const sheet = workbook.addWorksheet('Kardex');

    sheet.addRow([`Kardex — ${context.productName} (${context.sku})`]);
    sheet.addRow([`Ubicación: ${context.locationLabel}`]);
    sheet.addRow([`Periodo: ${rangeLabel(context)}`]);
    sheet.addRow([`Generado: ${new Date().toLocaleString('es')}`]);
    sheet.addRow([]);
    sheet.getRow(1).font = { bold: true, size: 14 };

    const columns = context.canViewCost
      ? ['Fecha del movimiento', 'Movimiento', 'Entrada', 'Costo U', 'Salida', 'Costo K', 'Stock U', 'Stock S']
      : ['Fecha del movimiento', 'Movimiento', 'Entrada', 'Salida', 'Stock U'];
    const headerRow = sheet.addRow(columns);
    headerRow.font = { bold: true };

    for (const row of data.rows) {
      const cells: Array<string | number> = [new Date(row.occurredAt).toLocaleString('es'), row.label, row.entrada || '', row.salida || ''];
      if (context.canViewCost) {
        cells.splice(3, 0, row.unitCost !== undefined ? Number(row.unitCost.toFixed(2)) : '');
        cells.push(row.averageCostAfter !== undefined ? Number(row.averageCostAfter.toFixed(2)) : '', row.stockAfter, row.stockValueAfter !== undefined ? Number(row.stockValueAfter.toFixed(2)) : '');
      } else {
        cells.push(row.stockAfter);
      }
      sheet.addRow(cells);
    }

    sheet.columns.forEach((column) => {
      column.width = 20;
    });

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  async buildPdf(data: KardexResponseDto, context: KardexExportContext): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text(`Kardex — ${context.productName} (${context.sku})`);
      doc.fontSize(10).text(`Ubicación: ${context.locationLabel}`);
      doc.text(`Periodo: ${rangeLabel(context)}`);
      doc.text(`Generado: ${new Date().toLocaleString('es')}`);
      doc.moveDown();

      const columns = context.canViewCost
        ? ['Fecha del movimiento', 'Movimiento', 'Entrada', 'Costo U', 'Salida', 'Costo K', 'Stock U', 'Stock S']
        : ['Fecha del movimiento', 'Movimiento', 'Entrada', 'Salida', 'Stock U'];
      const columnWidth = doc.page.width / columns.length - 10;

      const drawRow = (values: string[], bold: boolean) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        const y = doc.y;
        values.forEach((value, index) => {
          doc.text(value, doc.page.margins.left + index * (columnWidth + 10), y, { width: columnWidth, ellipsis: true });
        });
        doc.moveDown(0.6);
        if (doc.y > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
        }
      };

      drawRow(columns, true);
      for (const row of data.rows) {
        const values = [new Date(row.occurredAt).toLocaleString('es'), row.label, row.entrada ? String(row.entrada) : '', row.salida ? String(row.salida) : ''];
        if (context.canViewCost) {
          values.splice(3, 0, money(row.unitCost));
          values.push(money(row.averageCostAfter), String(row.stockAfter), money(row.stockValueAfter));
        } else {
          values.push(String(row.stockAfter));
        }
        drawRow(values, false);
      }

      if (data.truncated) {
        doc.moveDown();
        doc.font('Helvetica-Oblique').fontSize(8).text('El resultado excedió el límite de filas — acota el rango de fechas para ver el resto.');
      }

      doc.end();
    });
  }
}
