import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { TabularExportService, type TabularExportSpec } from './tabular-export.service';

const spec: TabularExportSpec = {
  title: 'Transferencias',
  sheetName: 'Transferencias',
  subtitle: ['Todas las transferencias'],
  columns: [{ header: 'Código' }, { header: 'Líneas', align: 'right', format: 'integer' }, { header: 'Total', align: 'right' }],
  rows: [
    ['TRF-1', 3, 12.5],
    ['TRF-2', 1, 0],
  ],
  truncatedNote: 'cortado',
};

describe('TabularExportService', () => {
  const service = new TabularExportService();

  it('builds an xlsx with the header, every row, integer vs money formats and the truncation note', async () => {
    const buffer = await service.buildXlsx(spec);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet('Transferencias')!;
    const values: unknown[][] = [];
    sheet.eachRow((row) => values.push((row.values as unknown[]).slice(1)));
    expect(values[0]).toEqual(['Transferencias']);
    const headerIndex = values.findIndex((v) => v[0] === 'Código');
    expect(values[headerIndex]).toEqual(['Código', 'Líneas', 'Total']);
    expect(values[headerIndex + 1]).toEqual(['TRF-1', 3, 12.5]);
    expect(values[headerIndex + 2]).toEqual(['TRF-2', 1, 0]);
    let firstDataRow = 0;
    sheet.eachRow((row, rowNumber) => {
      if (row.getCell(1).value === 'TRF-1') firstDataRow = rowNumber;
    });
    expect(sheet.getRow(firstDataRow).getCell(2).numFmt).toBe('0');
    expect(sheet.getRow(firstDataRow).getCell(3).numFmt).toBe('#,##0.00');
    expect(values.some((v) => v[0] === 'cortado')).toBe(true);
  });

  it('builds a PDF', async () => {
    expect((await service.buildPdf(spec)).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('build() picks the format, content type and file name', async () => {
    const xlsx = await service.build(spec, 'xlsx', 'transferencias');
    expect(xlsx).toMatchObject({ filename: 'transferencias.xlsx', contentType: expect.stringContaining('spreadsheetml') });
    const pdf = await service.build(spec, 'pdf', 'transferencias');
    expect(pdf).toMatchObject({ filename: 'transferencias.pdf', contentType: 'application/pdf' });
  });

  it('copes with a large table (multi-page PDF)', async () => {
    const many = { ...spec, rows: Array.from({ length: 400 }, (_, i): [string, number, number] => [`TRF-${i}`, i, i * 1.5]) };
    expect((await service.buildPdf(many)).length).toBeGreaterThan(5000);
  });
});
