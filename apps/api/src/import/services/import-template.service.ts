import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AttributesRepository } from '../../catalog/repositories/attributes.repository';
import { CategoriesRepository } from '../../catalog/repositories/categories.repository';
import type { TenantTransaction } from '../../database/tenant-context';
import { ImportCatalogLookupRepository } from '../repositories/import-catalog-lookup.repository';

const BASE_COLUMNS: Array<{ header: string; field: string; width: number }> = [
  { header: 'Código', field: 'sku', width: 18 },
  { header: 'Nombre', field: 'name', width: 30 },
  { header: 'Categoría', field: 'category', width: 20 },
  { header: 'Descripción', field: 'description', width: 30 },
  { header: 'Unidad', field: 'unit', width: 10 },
  { header: 'Código de barras', field: 'barcode', width: 18 },
  { header: 'Costo', field: 'cost', width: 12 },
  { header: 'Precio máximo', field: 'maxPrice', width: 14 },
  { header: 'Precio base', field: 'basePrice', width: 14 },
  { header: 'Precio mínimo', field: 'minPrice', width: 14 },
  { header: 'Cantidad', field: 'quantity', width: 12 },
  { header: 'Sucursal', field: 'warehouse', width: 20 },
  { header: 'Almacén', field: 'location', width: 20 },
  { header: 'Referencia de producto', field: 'productRef', width: 20 },
  { header: 'Número de serie', field: 'serialNumber', width: 20 },
  { header: 'Número de lote', field: 'lotNumber', width: 20 },
  { header: 'Fecha de fabricación (AAAA-MM-DD)', field: 'manufacturedDate', width: 24 },
  { header: 'Fecha de vencimiento (AAAA-MM-DD)', field: 'expiryDate', width: 24 },
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
    const usedHeaders = new Set(columns.map((c) => c.header.toLowerCase()));
    const addAttribute = (def: { code: string; name: string; isRequired: boolean }): void => {
      // A template header must be unique (the parser rejects duplicate headers): an attribute named
      // like a base column gets an "(atributo)" marker, which the upload-time matching ignores.
      const base = usedHeaders.has(def.name.toLowerCase()) ? `${def.name} (atributo)` : def.name;
      const header = `${base}${def.isRequired ? ' (obligatorio)' : ''}`;
      usedHeaders.add(def.name.toLowerCase());
      columns.push({ header, field: `attr:${def.code}`, width: 20 });
    };
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
        addAttribute(def);
      }
    } else {
      // General template: every active attribute of the tenant, so attribute data can be loaded
      // without picking a category first (a value for an attribute the row's category does not use
      // is reported by validation, never silently dropped).
      const definitions = await this.attributesRepository.listDefinitionsByTenant(tx, tenantId, 'active');
      for (const def of definitions) addAttribute({ code: def.code, name: def.name, isRequired: false });
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

    // One row per Almacén with the Sucursal it belongs to — the pair the Sucursal/Almacén columns
    // of the template expect (an Almacén name can repeat across sucursales, e.g. "General").
    const warehouseNameById = new Map(warehouseNames.map((w) => [w.id, w.name]));
    const reference = workbook.addWorksheet('Referencia');
    reference.columns = [
      { header: 'Sucursal', key: 'warehouse', width: 24 },
      { header: 'Almacén', key: 'location', width: 24 },
      { header: 'Código del almacén', key: 'code', width: 20 },
    ];
    reference.getRow(1).font = { bold: true };
    const rows = locationNames
      .map((l) => ({ warehouse: warehouseNameById.get(l.warehouseId) ?? '', location: l.name, code: l.code }))
      .sort((a, b) => a.warehouse.localeCompare(b.warehouse) || a.location.localeCompare(b.location));
    for (const row of rows) reference.addRow(row);
  }
}
