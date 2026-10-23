import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { cellValue } from '../../common/spreadsheet/xlsx-cell';

/** Most rows one bulk stock load accepts (decided with the owner). More would need a background job. */
export const BULK_RECEIPT_MAX_ROWS = 500;
/** A 500-row, 4-column sheet is a few tens of KB; this is a generous ceiling, not a target. */
export const BULK_RECEIPT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** The four columns of the file, in the order the template writes them. */
export const BULK_RECEIPT_HEADERS = ['Código', 'Cantidad', 'Costo unitario', 'Motivo'] as const;

export interface BulkReceiptRawRow {
  /** The row's own number in the spreadsheet (header = 1), so an error points at the real row. */
  rowNumber: number;
  code: string;
  quantity: unknown;
  unitCost: unknown;
  reason: string;
}

/** Case-, accent- and spacing-insensitive header key ("Código de producto" ≡ "codigo de producto"). */
function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADER_ALIASES: Record<'code' | 'quantity' | 'unitCost' | 'reason', string[]> = {
  code: ['codigo', 'codigo de producto', 'codigo del producto'],
  quantity: ['cantidad'],
  unitCost: ['costo unitario', 'costo'],
  reason: ['motivo'],
};

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Reads the first sheet of a bulk stock-load workbook: only the four expected columns, found by
 * their header (any order, extra columns ignored). Structural problems — not an .xlsx, no sheet, a
 * missing column, no data rows, more than `BULK_RECEIPT_MAX_ROWS` — are request errors (400); anything
 * about a row's *content* is left to the row validation so the user sees every problem at once. Cell
 * values only, never formulas (shared `cellValue`).
 */
export async function parseBulkReceiptFile(buffer: Buffer): Promise<BulkReceiptRawRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs's own .d.ts resolves `Buffer` against a nested duplicate @types/node (pnpm hoisting
    // artifact) — same workaround the import pipeline's parser uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new BadRequestException('El archivo no es una hoja de cálculo .xlsx válida.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new BadRequestException('El archivo no tiene ninguna hoja.');
  }

  const columnByField = new Map<keyof typeof HEADER_ALIASES, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const key = normalizeHeader(asText(cellValue(cell.value)));
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof typeof HEADER_ALIASES, string[]][]) {
      if (aliases.includes(key) && !columnByField.has(field)) columnByField.set(field, columnNumber);
    }
  });
  const missing = (
    [
      ['code', 'Código'],
      ['quantity', 'Cantidad'],
      ['unitCost', 'Costo unitario'],
      ['reason', 'Motivo'],
    ] as const
  )
    .filter(([field]) => !columnByField.has(field))
    .map(([, label]) => label);
  if (missing.length > 0) {
    throw new BadRequestException(`Faltan columnas en la primera fila del archivo: ${missing.join(', ')}. Descarga la plantilla para ver el formato.`);
  }

  const rows: BulkReceiptRawRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const read = (field: keyof typeof HEADER_ALIASES): unknown => cellValue(row.getCell(columnByField.get(field)!).value);
    const raw: BulkReceiptRawRow = {
      rowNumber,
      code: asText(read('code')),
      quantity: read('quantity'),
      unitCost: read('unitCost'),
      reason: asText(read('reason')),
    };
    // A completely empty row (formatting only) is not a data row.
    if (raw.code === '' && raw.reason === '' && asText(raw.quantity) === '' && asText(raw.unitCost) === '') continue;
    rows.push(raw);
    if (rows.length > BULK_RECEIPT_MAX_ROWS) {
      throw new BadRequestException(`El archivo tiene más de ${BULK_RECEIPT_MAX_ROWS} filas. Divídelo en archivos de hasta ${BULK_RECEIPT_MAX_ROWS} filas.`);
    }
  }
  if (rows.length === 0) {
    throw new BadRequestException('El archivo no tiene filas con datos debajo de los encabezados.');
  }
  return rows;
}

/** Parses a cell as a finite number; accepts a numeric cell or text such as "12", "12.5" or "12,5". */
export function toNumber(value: unknown): number | 'invalid' | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 'invalid';
  const text = String(value).trim();
  if (text === '') return undefined;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 'invalid';
}
