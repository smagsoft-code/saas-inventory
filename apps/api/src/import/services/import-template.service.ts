import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AttributesRepository } from '../../catalog/repositories/attributes.repository';
import { CategoriesRepository } from '../../catalog/repositories/categories.repository';
import type { TenantTransaction } from '../../database/tenant-context';
import { ImportCatalogLookupRepository } from '../repositories/import-catalog-lookup.repository';

const BASE_COLUMNS: Array<{ header: string; field: string; width: number }> = [
  { header: 'SKU', field: 'sku', width: 18 },
  { header: 'Nombre', field: 'name', width: 30 },
  { header: 'Categoria', field: 'category', width: 20 },
  { header: 'Marca', field: 'brand', width: 18 },
  { header: 'Proveedor', field: 'supplier', width: 18 },
  { header: 'Descripcion', field: 'description', width: 30 },
  { header: 'Unidad', field: 'unit', width: 10 },
  { header: 'Codigo de Barras', field: 'barcode', width: 18 },
  { header: 'Costo', field: 'cost', width: 12 },
  { header: 'Precio maximo', field: 'maxPrice', width: 14 },
  { header: 'Precio base', field: 'basePrice', width: 14 },
  { header: 'Precio minimo', field: 'minPrice', width: 14 },
  { header: 'Cantidad', field: 'quantity', width: 12 },
  { header: 'Ubicacion', field: 'location', width: 20 },
  { header: 'Referencia de Producto', field: 'productRef', width: 20 },
  { header: 'Numero de Serie', field: 'serialNumber', width: 20 },
  { header: 'Numero de Lote', field: 'lotNumber', width: 20 },
  { header: 'Fecha de Fabricacion (AAAA-MM-DD)', field: 'manufacturedDate', width: 24 },
  { header: 'Fecha de Vencimiento (AAAA-MM-DD)', field: 'expiryDate', width: 24 },
];

/**
 * §5/§6 — the Excel template is generated from the tenant's real, current governance data (never a
 * static/hardcoded file), so it only ever offers columns the validation pass will actually accept.
 * `attr:<code>` columns come straight from ADR-0026's category_attributes/attribute_definitions —
 * the same source AttributeValidationService itself reads, never a duplicated attribute list.
 */
@Injectable()
export class ImportTemplateService {
  constructor(
    private readonly categoriesRepository: CategoriesRepository,
    private readonly attributesRepository: AttributesRepository,
    private readonly catalogLookup: ImportCatalogLookupRepository,
  ) {}

  async generate(tx: TenantTransaction, tenantId: string, categoryId: string | undefined): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'saas-inventory';
    const sheet = workbook.addWorksheet('Importar');

    const columns = [...BASE_COLUMNS];
    if (categoryId) {
      const category = await this.categoriesRepository.findById(tx, tenantId, categoryId);
      if (!category) {
        throw new NotFoundException('Category not found.');
      }
      const [productAttrs, variantAttrs] = await Promise.all([
        this.attributesRepository.listApplicableForCategory(tx, tenantId, categoryId, 'product'),
        this.attributesRepository.listApplicableForCategory(tx, tenantId, categoryId, 'variant'),
      ]);
      const seen = new Set<string>();
      for (const def of [...productAttrs, ...variantAttrs]) {
        if (seen.has(def.code)) continue;
        seen.add(def.code);
        columns.push({ header: `${def.name}${def.isRequired ? ' (obligatorio)' : ''}`, field: `attr:${def.code}`, width: 20 });
      }
    }

    sheet.columns = columns.map((col) => ({ header: col.header, key: col.field, width: col.width }));
    sheet.getRow(1).font = { bold: true };

    await this.addReferenceSheet(tx, tenantId, workbook);

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  /** A read-only "Referencia" sheet listing the exact category/warehouse/location names this
   * tenant has today — §5's "no inventes columnas de atributos que no esten definidas", extended
   * to every free-text lookup column so the user copies exact values instead of guessing. */
  private async addReferenceSheet(tx: TenantTransaction, tenantId: string, workbook: ExcelJS.Workbook): Promise<void> {
    const [warehouseNames, locationNames] = await Promise.all([
      this.catalogLookup.listWarehouseNames(tx, tenantId),
      this.catalogLookup.listLocationNames(tx, tenantId),
    ]);

    const reference = workbook.addWorksheet('Referencia');
    reference.columns = [
      { header: 'Almacenes', key: 'warehouse', width: 24 },
      { header: 'Ubicaciones', key: 'location', width: 24 },
    ];
    reference.getRow(1).font = { bold: true };
    const rowCount = Math.max(warehouseNames.length, locationNames.length);
    for (let i = 0; i < rowCount; i += 1) {
      reference.addRow({ warehouse: warehouseNames[i]?.name ?? '', location: locationNames[i]?.name ?? '' });
    }
  }
}
