import type ExcelJS from 'exceljs';

/** Reads only the cached value of a cell, never its formula string — security.md#file-upload-security's
 * "the parser reads cell values only, never evaluating formulas as live/executable". A formula
 * cell's last-computed `.result` (whatever Excel itself cached in the file) is used as-is; this
 * code never interprets `.formula` as executable. Shared by every Excel upload (the import pipeline
 * and the bulk stock load). */
export function cellValue(raw: ExcelJS.CellValue): string | number | boolean | Date | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' || raw instanceof Date) return raw;
  if (typeof raw === 'object') {
    if ('richText' in raw) return raw.richText.map((part) => part.text).join('');
    if ('text' in raw && typeof raw.text === 'string') return raw.text;
    if ('result' in raw) {
      const result = raw.result;
      if (result === null || result === undefined) return null;
      if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean' || result instanceof Date) return result;
      return null;
    }
    if ('error' in raw) return null;
  }
  return null;
}
