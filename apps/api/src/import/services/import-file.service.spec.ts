import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it } from 'vitest';
import { ImportFileService } from './import-file.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroEnabled.12';

async function buildWorkbookBuffer(build: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  build(sheet);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('ImportFileService', () => {
  let service: ImportFileService;

  beforeEach(() => {
    service = new ImportFileService();
  });

  describe('assertUploadIsAcceptable — §11/§30/security.md#file-upload-security', () => {
    it('accepts a well-formed .xlsx upload', () => {
      expect(() => service.assertUploadIsAcceptable('catalogo.xlsx', XLSX_MIME, 1024)).not.toThrow();
    });

    it('rejects .xlsm by extension, even with an xlsx-looking mimetype', () => {
      expect(() => service.assertUploadIsAcceptable('catalogo.xlsm', XLSX_MIME, 1024)).toThrow(BadRequestException);
    });

    it('rejects a macro-enabled mimetype outright', () => {
      expect(() => service.assertUploadIsAcceptable('catalogo.xlsx', XLSM_MIME, 1024)).toThrow(BadRequestException);
    });

    it('rejects a non-.xlsx extension', () => {
      expect(() => service.assertUploadIsAcceptable('catalogo.csv', XLSX_MIME, 1024)).toThrow(BadRequestException);
      expect(() => service.assertUploadIsAcceptable('catalogo.xls', XLSX_MIME, 1024)).toThrow(BadRequestException);
    });

    it('rejects a mismatched declared content-type', () => {
      expect(() => service.assertUploadIsAcceptable('catalogo.xlsx', 'text/csv', 1024)).toThrow(BadRequestException);
    });

    it('rejects an empty file', () => {
      expect(() => service.assertUploadIsAcceptable('catalogo.xlsx', XLSX_MIME, 0)).toThrow(BadRequestException);
    });

    it('rejects a file over the configured size limit', () => {
      const previous = process.env['IMPORT_MAX_FILE_SIZE_BYTES'];
      process.env['IMPORT_MAX_FILE_SIZE_BYTES'] = '100';
      try {
        expect(() => service.assertUploadIsAcceptable('catalogo.xlsx', XLSX_MIME, 200)).toThrow(BadRequestException);
      } finally {
        if (previous === undefined) delete process.env['IMPORT_MAX_FILE_SIZE_BYTES'];
        else process.env['IMPORT_MAX_FILE_SIZE_BYTES'] = previous;
      }
    });
  });

  describe('parse — §11/§30, security.md: values only, never formulas', () => {
    it('parses headers and rows into header-keyed records', async () => {
      const buffer = await buildWorkbookBuffer((sheet) => {
        sheet.addRow(['SKU', 'Nombre', 'Cantidad']);
        sheet.addRow(['SKU-1', 'Widget', 10]);
        sheet.addRow(['SKU-2', 'Gadget', 5]);
      });
      const result = await service.parse(buffer);
      expect(result.headers).toEqual(['SKU', 'Nombre', 'Cantidad']);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({ rowNumber: 2, data: { SKU: 'SKU-1', Nombre: 'Widget', Cantidad: 10 } });
      expect(result.rows[1]).toEqual({ rowNumber: 3, data: { SKU: 'SKU-2', Nombre: 'Gadget', Cantidad: 5 } });
    });

    it('reads a formula cell as its cached result, never the formula string', async () => {
      const buffer = await buildWorkbookBuffer((sheet) => {
        sheet.addRow(['SKU', 'Total']);
        const row = sheet.addRow(['SKU-1', null]);
        row.getCell(2).value = { formula: 'A1&"!"', result: 'safe-value' } as unknown as ExcelJS.CellValue;
      });
      const result = await service.parse(buffer);
      expect(result.rows[0]?.data['Total']).toBe('safe-value');
    });

    it('rejects a file with no header row', async () => {
      const buffer = await buildWorkbookBuffer(() => {
        // no rows at all
      });
      await expect(service.parse(buffer)).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate column headers', async () => {
      const buffer = await buildWorkbookBuffer((sheet) => {
        sheet.addRow(['SKU', 'SKU']);
        sheet.addRow(['SKU-1', 'SKU-1-dup']);
      });
      await expect(service.parse(buffer)).rejects.toThrow(BadRequestException);
    });

    it('rejects a corrupt / non-xlsx buffer', async () => {
      await expect(service.parse(Buffer.from('this is not a real xlsx file'))).rejects.toThrow(BadRequestException);
    });

    it('skips a fully-blank row', async () => {
      const buffer = await buildWorkbookBuffer((sheet) => {
        sheet.addRow(['SKU', 'Nombre']);
        sheet.addRow(['SKU-1', 'Widget']);
        sheet.addRow([null, null]);
        sheet.addRow(['SKU-2', 'Gadget']);
      });
      const result = await service.parse(buffer);
      expect(result.rows.map((r) => r.data['SKU'])).toEqual(['SKU-1', 'SKU-2']);
    });

    it('rejects a file with more data rows than IMPORT_MAX_ROWS', async () => {
      const previous = process.env['IMPORT_MAX_ROWS'];
      process.env['IMPORT_MAX_ROWS'] = '2';
      try {
        const buffer = await buildWorkbookBuffer((sheet) => {
          sheet.addRow(['SKU']);
          sheet.addRow(['SKU-1']);
          sheet.addRow(['SKU-2']);
          sheet.addRow(['SKU-3']);
        });
        await expect(service.parse(buffer)).rejects.toThrow(BadRequestException);
      } finally {
        if (previous === undefined) delete process.env['IMPORT_MAX_ROWS'];
        else process.env['IMPORT_MAX_ROWS'] = previous;
      }
    });
  });
});
