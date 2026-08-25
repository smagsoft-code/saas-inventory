import { BadRequestException, Injectable } from '@nestjs/common';
import { getOptionalEnvVar } from '@saas-inventory/config';
import ExcelJS from 'exceljs';
import { ObjectStorageService } from '../../common/storage/object-storage.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroEnabled.12';

export interface ParsedImportRow {
  rowNumber: number;
  data: Record<string, unknown>;
}

export interface ParsedImportFile {
  headers: string[];
  rows: ParsedImportRow[];
}

function maxFileSizeBytes(): number {
  return Number(getOptionalEnvVar('IMPORT_MAX_FILE_SIZE_BYTES', '26214400'));
}

function maxRows(): number {
  return Number(getOptionalEnvVar('IMPORT_MAX_ROWS', '100000'));
}

/** Reads only the cached value of a cell, never its formula string — security.md#file-upload-security's
 * "the parser reads cell values only, never evaluating formulas as live/executable". A formula
 * cell's last-computed `.result` (whatever Excel itself cached in the file) is used as-is; this
 * code never interprets `.formula` as executable. */
function cellValue(raw: ExcelJS.CellValue): string | number | boolean | Date | null {
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

/**
 * §11/§12/§30, security.md#file-upload-security, threat-model.md#malicious-file-upload — file-level
 * structural validation and parsing, entirely separate from row-data validation
 * (ImportValidationService). `.xlsx` only, MIME checked against actual declared content-type (never
 * trusted alone — the parse itself is the real structural check, since a renamed non-xlsx file
 * fails to open as one), size- and row-capped before anything is staged.
 */
@Injectable()
export class ImportFileService {
  assertUploadIsAcceptable(originalFilename: string, mimeType: string, size: number): void {
    const lower = originalFilename.toLowerCase();
    if (lower.endsWith('.xlsm')) {
      throw new BadRequestException('Macro-enabled spreadsheets (.xlsm) are not accepted.');
    }
    if (!lower.endsWith('.xlsx')) {
      throw new BadRequestException('Only .xlsx files are accepted.');
    }
    if (mimeType === XLSM_MIME) {
      throw new BadRequestException('Macro-enabled spreadsheets (.xlsm) are not accepted.');
    }
    if (mimeType !== XLSX_MIME) {
      throw new BadRequestException('Unexpected file content-type — only .xlsx spreadsheets are accepted.');
    }
    if (size <= 0) {
      throw new BadRequestException('The uploaded file is empty.');
    }
    if (size > maxFileSizeBytes()) {
      throw new BadRequestException(`The uploaded file exceeds the maximum allowed size of ${maxFileSizeBytes()} bytes.`);
    }
  }

  async parse(buffer: Buffer): Promise<ParsedImportFile> {
    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs's own .d.ts resolves `Buffer` against a nested, duplicate @types/node copy in its
      // dependency tree (a pnpm workspace hoisting artifact — structurally identical, nominally
      // distinct) — `any` sidesteps chasing that mismatch; the runtime value is a plain Node Buffer
      // either way.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException('The uploaded file is not a valid, readable .xlsx spreadsheet.');
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('The spreadsheet has no sheets.');
    }

    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
      const value = cellValue(cell.value);
      const header = value === null ? '' : String(value).trim();
      if (header !== '') headers.push(header);
    });
    if (headers.length === 0) {
      throw new BadRequestException('The spreadsheet has no header row.');
    }
    const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
    if (duplicateHeaders.length > 0) {
      throw new BadRequestException(`Duplicate column headers: ${[...new Set(duplicateHeaders)].join(', ')}.`);
    }

    const totalDataRows = sheet.rowCount - 1;
    if (totalDataRows > maxRows()) {
      throw new BadRequestException(`The spreadsheet has ${totalDataRows} rows, exceeding the maximum of ${maxRows()}.`);
    }

    const rows: ParsedImportRow[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      if (row.cellCount === 0 || row.values === undefined || (Array.isArray(row.values) && row.values.length === 0)) {
        continue;
      }
      const data: Record<string, unknown> = {};
      let hasAnyValue = false;
      headerRow.eachCell({ includeEmpty: false }, (headerCell, colNumber) => {
        const header = String(cellValue(headerCell.value) ?? '').trim();
        if (header === '') return;
        const value = cellValue(row.getCell(colNumber).value);
        if (value !== null) hasAnyValue = true;
        data[header] = value;
      });
      if (!hasAnyValue) continue;
      rows.push({ rowNumber, data });
    }

    return { headers, rows };
  }
}

/** Storage-key layout for uploaded originals and generated error reports — kept alongside the
 * parser rather than in ObjectStorageService itself, since the naming convention is IMPORT's own
 * concern, not a generic storage-client one. */
@Injectable()
export class ImportFileStorage {
  constructor(private readonly objectStorage: ObjectStorageService) {}

  async storeUpload(tenantId: string, jobId: string, buffer: Buffer): Promise<string> {
    const key = `imports/${tenantId}/${jobId}/upload.xlsx`;
    await this.objectStorage.putObject(key, buffer, XLSX_MIME);
    return key;
  }

  async storeErrorReport(tenantId: string, jobId: string, buffer: Buffer): Promise<string> {
    const key = `imports/${tenantId}/${jobId}/errors.xlsx`;
    await this.objectStorage.putObject(key, buffer, XLSX_MIME);
    return key;
  }

  async getObject(key: string): Promise<Buffer> {
    return this.objectStorage.getObject(key);
  }
}
