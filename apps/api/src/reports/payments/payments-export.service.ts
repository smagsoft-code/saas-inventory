import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { PaymentRowDto, PaymentsReportResponseDto } from './dto/payments-report-response.dto';

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
  other: 'Otro',
};

export const RETURN_NOTE = 'Orden con devolución: el pago no se reversa; el monto es el cobrado originalmente.';

export interface PaymentsExportContext {
  timezone: string;
  currency: string;
  dateFrom: string;
  dateTo: string | undefined;
  truncated: boolean;
}

const MONEY = new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TRUNCATED_NOTE = 'El resultado excedió el límite de filas — acota el rango de fechas para ver el resto.';
const COLUMNS = ['Fecha de pago', 'N.º de orden', 'Cliente', 'Forma de pago', 'Monto', 'Vendedor', 'Almacén', 'Documento'] as const;

function dateTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('es', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString('es');
  }
}

function rangeLabel(context: PaymentsExportContext): string {
  return context.dateTo && context.dateTo !== context.dateFrom ? `${context.dateFrom} – ${context.dateTo}` : context.dateFrom;
}

function returnText(row: PaymentRowDto): string {
  if (!row.returns) return '';
  return `Devolución ${row.returns.numbers.join(', ')} (valor devuelto ${MONEY.format(row.returns.returnedValue)})`;
}

const documentLabel = (row: PaymentRowDto): string => (row.documentType === 'invoice' ? 'Factura' : 'Nota de venta');
const methodLabel = (row: PaymentRowDto): string => PAYMENT_METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod;

/**
 * Built from the exact `PaymentsReportResponseDto` the screen renders (same filters, same sort) —
 * never a separate unfiltered query — the same rule as `KardexExportService`. A row whose order has
 * a return gets its amount on a red fill plus the explanatory note, in both formats.
 */
@Injectable()
export class PaymentsExportService {
  async buildXlsx(data: PaymentsReportResponseDto, context: PaymentsExportContext): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'saas-inventory';
    const sheet = workbook.addWorksheet('Formas de pago');

    sheet.addRow(['Formas de pago']);
    sheet.addRow([`Periodo: ${rangeLabel(context)}`]);
    sheet.addRow([`Generado: ${new Date().toLocaleString('es')}`]);
    sheet.addRow([`Total: ${MONEY.format(data.totals.amount)} ${context.currency} en ${data.totals.paymentCount} pago(s)`]);
    for (const m of data.totals.byMethod) {
      sheet.addRow([`${PAYMENT_METHOD_LABELS[m.paymentMethod] ?? m.paymentMethod}: ${MONEY.format(m.amount)} (${m.paymentCount})`]);
    }
    sheet.addRow([]);
    sheet.getRow(1).font = { bold: true, size: 14 };

    sheet.addRow([...COLUMNS, 'Nota']).font = { bold: true };
    for (const row of data.data) {
      const added = sheet.addRow([
        dateTime(row.paidAt, context.timezone),
        row.orderNumber,
        row.customerName,
        methodLabel(row),
        Number(row.amount.toFixed(2)),
        row.sellerName ?? '',
        row.locationLabel,
        documentLabel(row),
        returnText(row),
      ]);
      const amountCell = added.getCell(5);
      amountCell.numFmt = '#,##0.00';
      if (row.returns) {
        amountCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
        amountCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      }
    }

    if (data.data.some((r) => r.returns)) {
      sheet.addRow([]);
      sheet.addRow([`Nota: ${RETURN_NOTE}`]);
    }
    if (context.truncated) {
      sheet.addRow([TRUNCATED_NOTE]);
    }
    sheet.columns.forEach((column) => {
      column.width = 22;
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async buildPdf(data: PaymentsReportResponseDto, context: PaymentsExportContext): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text('Formas de pago');
      doc.fontSize(10).text(`Periodo: ${rangeLabel(context)}`);
      doc.text(`Generado: ${new Date().toLocaleString('es')}`);
      doc.text(`Total: ${MONEY.format(data.totals.amount)} ${context.currency} en ${data.totals.paymentCount} pago(s)`);
      doc.text(data.totals.byMethod.map((m) => `${PAYMENT_METHOD_LABELS[m.paymentMethod] ?? m.paymentMethod}: ${MONEY.format(m.amount)}`).join('   '));
      doc.moveDown();

      const left = doc.page.margins.left;
      const usable = doc.page.width - left - doc.page.margins.right;
      const weights = [1.1, 1, 1.6, 1.1, 1, 1.3, 1.5, 1];
      const weightSum = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => (w / weightSum) * usable - 4);
      const offsets = widths.map((_, i) => left + widths.slice(0, i).reduce((a, b) => a + b + 4, 0));
      const AMOUNT = 4;

      const ensureSpace = (height: number): void => {
        if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
      };
      const drawRow = (values: string[], bold: boolean, alert: boolean): void => {
        ensureSpace(14);
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        const y = doc.y;
        values.forEach((value, index) => {
          const x = offsets[index] ?? left;
          const width = widths[index] ?? 60;
          if (alert && index === AMOUNT) {
            doc.save().rect(x - 2, y - 1, width + 2, 11).fill('#dc2626').restore();
            doc.fillColor('#ffffff');
          } else {
            doc.fillColor('#000000');
          }
          doc.text(value, x, y, { width, ellipsis: true, lineBreak: false });
        });
        doc.fillColor('#000000');
        doc.y = y + 13;
      };

      drawRow([...COLUMNS], true, false);
      for (const row of data.data) {
        drawRow(
          [dateTime(row.paidAt, context.timezone), row.orderNumber, row.customerName, methodLabel(row), MONEY.format(row.amount), row.sellerName ?? '', row.locationLabel, documentLabel(row)],
          false,
          Boolean(row.returns),
        );
        if (row.returns) {
          ensureSpace(10);
          const y = doc.y - 3;
          doc.font('Helvetica-Oblique').fontSize(7).fillColor('#b91c1c').text(returnText(row), offsets[2] ?? left, y, { width: usable - 100, lineBreak: false });
          doc.fillColor('#000000');
          doc.y = y + 10;
        }
      }

      if (data.data.some((r) => r.returns)) {
        doc.moveDown();
        doc.font('Helvetica-Oblique').fontSize(8).text(`Nota: ${RETURN_NOTE}`, left);
      }
      if (context.truncated) {
        doc.moveDown();
        doc.font('Helvetica-Oblique').fontSize(8).text(TRUNCATED_NOTE, left);
      }
      doc.end();
    });
  }
}
