import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { TenantSettingsRepository } from '../../administration/tenant-settings/tenant-settings.repository';
import { DEFAULT_TIMEZONE } from '../../administration/tenant-settings/tenant-settings.service';
import { localDayRangeToUtc } from '../../common/reporting/local-day-range';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { AuditMeta } from '../inventory-audit-meta';
import { LocationAuthorizationService } from '../location-authorization.service';
import { MovementsService } from '../movements/movements.service';
import { IdempotencyKeysRepository } from '../repositories/idempotency-keys.repository';
import { LocationsRepository } from '../repositories/locations.repository';
import { BulkReceiptsLookupRepository } from '../repositories/bulk-receipts-lookup.repository';
import {
  BULK_RECEIPT_HEADERS,
  BULK_RECEIPT_MAX_FILE_BYTES,
  BULK_RECEIPT_MAX_ROWS,
  parseBulkReceiptFile,
  toNumber,
  type BulkReceiptRawRow,
} from './bulk-receipts.parser';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const IDEMPOTENCY_SCOPE = 'inventory.receipts.bulk';
const IDEMPOTENCY_TTL_MS = 48 * 60 * 60 * 1000;
const NOON_MS = 12 * 60 * 60 * 1000;
const REASON_MAX = 500;

export interface BulkReceiptRow {
  rowNumber: number;
  code: string;
  productName?: string;
  quantity?: number;
  unitCost?: number;
  reason: string;
  /** Spanish, user-facing: what is wrong and how to fix it. Empty = the row is valid. */
  errors: string[];
}

export interface BulkReceiptPreview {
  locationId: string;
  /** ISO instant the movements will carry, or `null` = "now" (no date, or today). */
  occurredAt: string | null;
  rows: BulkReceiptRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  /** Σ quantity of the valid rows. */
  totalQuantity: number;
}

export interface BulkReceiptResult {
  loadedRows: number;
  totalQuantity: number;
  occurredAt: string | null;
  movements: { rowNumber: number; code: string; productName: string; quantity: number; balanceAfter: number }[];
}

export interface BulkReceiptInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  locationId: string;
  /** Optional calendar day (`YYYY-MM-DD`, tenant timezone) the stock entered; default = today. */
  occurredOn?: string | undefined;
}

/** What validation resolves per row, beyond the display row: the variant to write against. */
interface ResolvedRow {
  display: BulkReceiptRow;
  variantId?: string;
}

/**
 * "Carga masiva de stock" — many `RECEIPT` movements into ONE almacén from an Excel file with four
 * columns (Código, Cantidad, Costo unitario, Motivo). Rules (agreed with the owner):
 *  - **All or nothing**: every row is validated first; if any row has an error NOTHING is written
 *    and the user fixes the file; if all are valid they are written in one transaction.
 *  - At most `BULK_RECEIPT_MAX_ROWS` rows; the same permission (`inventory.adjust`) and the same
 *    ADR-0024 location check as "Agregar stock"; each row goes through the exact same code path as a
 *    single "Agregar stock" (`MovementsService.createAdjustmentInTx` → the locking ledger convoy,
 *    moving-average cost, audit) — never a parallel write path.
 *  - **Double submit is safe**: the confirm call needs an `Idempotency-Key`; a retry with the same key
 *    and the same file/almacén/date returns the first result instead of loading the stock twice.
 *  - One optional **movement date** for the whole file (not per row): default now, never in the
 *    future. A past date inserts the entries earlier in the Kardex's chronology (history from that
 *    date on is recomputed) — the UI warns before confirming.
 */
@Injectable()
export class BulkReceiptsService {
  constructor(
    private readonly locationsRepository: LocationsRepository,
    private readonly locationAuthorizationService: LocationAuthorizationService,
    private readonly lookupRepository: BulkReceiptsLookupRepository,
    private readonly movementsService: MovementsService,
    private readonly idempotencyKeysRepository: IdempotencyKeysRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
  ) {}

  /** The blank template: the four columns + a short "Instrucciones" sheet. */
  async buildTemplate(tenantId: string, canViewCost: boolean): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'saas-inventory';
    const sheet = workbook.addWorksheet('Carga');
    sheet.columns = BULK_RECEIPT_HEADERS.map((header, index) => ({ header, key: header, width: [22, 12, 16, 40][index] ?? 20 }));
    sheet.getRow(1).font = { bold: true };

    const help = workbook.addWorksheet('Instrucciones');
    help.columns = [{ header: 'Cómo llenar el archivo', key: 'text', width: 90 }];
    help.getRow(1).font = { bold: true };
    for (const line of [
      'Una fila por producto (variante). No repitas un código.',
      'Código: el código del producto tal como aparece en el sistema.',
      'Cantidad: un número mayor que 0.',
      'Costo unitario: lo que costó cada unidad (0 o más).',
      'Motivo: obligatorio (por ejemplo: compra a proveedor, producción propia).',
      `Máximo ${BULK_RECEIPT_MAX_ROWS} filas. La sucursal, el almacén y la fecha se eligen en la pantalla, no en el archivo.`,
      'La hoja "Productos" es solo de consulta: lista tus productos activos (código, nombre y, si tienes permiso, costo). No hace falta subirla ni conservarla.',
      'Si alguna fila tiene un error no se carga nada: corrige el archivo y vuélvelo a subir.',
    ]) {
      help.addRow({ text: line });
    }

    // Reference list so the user can copy codes (and, with permission, the catalog cost) into "Carga".
    const catalog = await withTenantTransaction(tenantId, (tx) => this.lookupRepository.listActive(tx, tenantId, canViewCost));
    const products = workbook.addWorksheet('Productos');
    products.columns = [
      { header: 'Código', key: 'sku', width: 22 },
      { header: 'Nombre', key: 'name', width: 50 },
      ...(canViewCost ? [{ header: 'Costo', key: 'cost', width: 14 }] : []),
    ];
    products.getRow(1).font = { bold: true };
    for (const row of catalog) {
      products.addRow({ sku: row.sku, name: row.productName, ...(canViewCost ? { cost: row.cost == null ? null : Number(row.cost) } : {}) });
    }
    products.views = [{ state: 'frozen', ySplit: 1 }];

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  async preview(tenantId: string, actorId: string, input: BulkReceiptInput): Promise<BulkReceiptPreview> {
    this.assertUploadIsAcceptable(input);
    const raw = await parseBulkReceiptFile(input.buffer);
    return withTenantTransaction(tenantId, async (tx) => {
      const { occurredAt } = await this.prepareLocationAndDate(tx, tenantId, actorId, input);
      const resolved = await this.validateRows(tx, tenantId, raw);
      return this.toPreview(input.locationId, occurredAt, resolved);
    });
  }

  async confirm(
    tenantId: string,
    actorId: string,
    input: BulkReceiptInput,
    idempotencyKey: string | undefined,
    meta: AuditMeta,
    canViewCost: boolean,
  ): Promise<BulkReceiptResult> {
    if (!idempotencyKey) {
      throw new BadRequestException('Falta el encabezado Idempotency-Key para cargar el stock.');
    }
    this.assertUploadIsAcceptable(input);
    const raw = await parseBulkReceiptFile(input.buffer);
    const requestHash = createHash('sha256')
      .update(input.buffer)
      .update(`|${input.locationId}|${input.occurredOn ?? ''}`)
      .digest('hex');

    return withTenantTransaction(tenantId, async (tx) => {
      // Serialize same-key requests before any work — the second concurrent request blocks here until
      // the first commits, then finds the stored result below (UNIQUE (tenant_id, scope, key) is the backstop).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${IDEMPOTENCY_SCOPE}:${tenantId}:${idempotencyKey}`}))`);
      const existing = await this.idempotencyKeysRepository.find(tx, tenantId, IDEMPOTENCY_SCOPE, idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException('Esa clave de envío ya se usó con un archivo, almacén o fecha distintos.');
        }
        return existing.responseBody as BulkReceiptResult;
      }

      const { occurredAt } = await this.prepareLocationAndDate(tx, tenantId, actorId, input);
      // The client's preview is never trusted: everything is validated again, here, under this transaction.
      const resolved = await this.validateRows(tx, tenantId, raw);
      const invalid = resolved.filter((row) => row.display.errors.length > 0);
      if (invalid.length > 0) {
        throw new UnprocessableEntityException({
          message: `No se cargó nada: ${invalid.length} fila${invalid.length === 1 ? '' : 's'} con errores. Corrige el archivo y vuelve a subirlo.`,
          preview: this.toPreview(input.locationId, occurredAt, resolved),
        });
      }

      // One transaction for every row (all or nothing), in a stable variant order so two concurrent
      // loads touching the same variants lock them in the same order and cannot deadlock.
      const ordered = [...resolved].sort((a, b) => a.variantId!.localeCompare(b.variantId!));
      const movements: BulkReceiptResult['movements'] = [];
      for (const row of ordered) {
        const movement = await this.movementsService.createAdjustmentInTx(
          tx,
          tenantId,
          actorId,
          {
            productVariantId: row.variantId!,
            locationId: input.locationId,
            movementType: 'RECEIPT',
            quantity: row.display.quantity!,
            unitCost: row.display.unitCost!,
            reason: row.display.reason,
            ...(occurredAt ? { occurredAt } : {}),
          },
          meta,
          canViewCost,
        );
        movements.push({
          rowNumber: row.display.rowNumber,
          code: row.display.code,
          productName: row.display.productName ?? '',
          quantity: row.display.quantity!,
          balanceAfter: movement.balanceAfter,
        });
      }
      movements.sort((a, b) => a.rowNumber - b.rowNumber);

      const result: BulkReceiptResult = {
        loadedRows: movements.length,
        totalQuantity: movements.reduce((sum, m) => sum + m.quantity, 0),
        occurredAt: occurredAt ?? null,
        movements,
      };
      await this.idempotencyKeysRepository.create(tx, {
        id: generateId(),
        tenantId,
        scope: IDEMPOTENCY_SCOPE,
        idempotencyKey,
        requestHash,
        responseStatus: 201,
        responseBody: result,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });
      return result;
    });
  }

  private assertUploadIsAcceptable(input: BulkReceiptInput): void {
    const lower = input.filename.toLowerCase();
    if (!lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
      throw new BadRequestException('Solo se aceptan archivos .xlsx.');
    }
    if (input.mimeType !== XLSX_MIME) {
      throw new BadRequestException('Tipo de archivo inesperado: solo se aceptan hojas de cálculo .xlsx.');
    }
    if (input.buffer.length <= 0) {
      throw new BadRequestException('El archivo está vacío.');
    }
    if (input.buffer.length > BULK_RECEIPT_MAX_FILE_BYTES) {
      throw new BadRequestException('El archivo es demasiado grande.');
    }
  }

  /** The almacén must exist and be one the caller may write to (ADR-0024); the date must be a valid
   * calendar day and not in the future. Returns the instant to stamp on the movements (`undefined` =
   * "now": no date given, or it is today). */
  private async prepareLocationAndDate(
    tx: TenantTransaction,
    tenantId: string,
    actorId: string,
    input: BulkReceiptInput,
  ): Promise<{ occurredAt: string | undefined }> {
    const location = await this.locationsRepository.findById(tx, tenantId, input.locationId);
    if (!location) {
      throw new NotFoundException('Almacén no encontrado.');
    }
    await this.locationAuthorizationService.assertAccess(tx, tenantId, actorId, input.locationId);

    if (!input.occurredOn) {
      return { occurredAt: undefined };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) {
      throw new BadRequestException('La fecha del movimiento debe tener el formato AAAA-MM-DD.');
    }
    const settings = await this.tenantSettingsRepository.find(tx, tenantId);
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (input.occurredOn > today) {
      throw new BadRequestException('La fecha del movimiento no puede ser futura.');
    }
    if (input.occurredOn === today) {
      return { occurredAt: undefined };
    }
    // A past day: noon of that day in the tenant's timezone — inside the day whatever the offset.
    const startOfDay = localDayRangeToUtc(input.occurredOn, undefined, timezone).gte;
    return { occurredAt: new Date(startOfDay.getTime() + NOON_MS).toISOString() };
  }

  private async validateRows(tx: TenantTransaction, tenantId: string, raw: BulkReceiptRawRow[]): Promise<ResolvedRow[]> {
    const variants = await this.lookupRepository.findByCodes(
      tx,
      tenantId,
      raw.map((row) => row.code).filter((code) => code !== ''),
    );
    const firstRowOfCode = new Map<string, number>();

    return raw.map((row): ResolvedRow => {
      const errors: string[] = [];
      const display: BulkReceiptRow = { rowNumber: row.rowNumber, code: row.code, reason: row.reason, errors };

      let variantId: string | undefined;
      if (row.code === '') {
        errors.push('El código es obligatorio.');
      } else {
        const key = row.code.toLowerCase();
        const firstRow = firstRowOfCode.get(key);
        if (firstRow !== undefined) {
          errors.push(`El código «${row.code}» ya aparece en la fila ${firstRow}. Deja una sola fila por código.`);
        } else {
          firstRowOfCode.set(key, row.rowNumber);
        }
        const variant = variants.get(key);
        if (!variant) {
          errors.push(`No existe un producto con el código «${row.code}».`);
        } else {
          display.productName = variant.productName;
          if (variant.variantStatus !== 'active' || variant.productStatus !== 'active') {
            errors.push(`El producto «${variant.productName}» está descontinuado: no se le puede cargar stock.`);
          } else if (variant.isSerialized || variant.isLotTracked) {
            errors.push(
              `«${variant.productName}» se controla por ${variant.isSerialized ? 'número de serie' : 'lote'}: su stock no se puede cargar por Excel, porque cada unidad necesita ese dato.`,
            );
          } else {
            variantId = variant.variantId;
          }
        }
      }

      const quantity = toNumber(row.quantity);
      if (quantity === undefined) errors.push('La cantidad es obligatoria.');
      else if (quantity === 'invalid') errors.push('La cantidad debe ser un número.');
      else if (quantity <= 0) errors.push('La cantidad debe ser mayor que 0.');
      else display.quantity = quantity;

      const unitCost = toNumber(row.unitCost);
      if (unitCost === undefined) errors.push('El costo unitario es obligatorio.');
      else if (unitCost === 'invalid') errors.push('El costo unitario debe ser un número.');
      else if (unitCost < 0) errors.push('El costo unitario no puede ser negativo.');
      else display.unitCost = unitCost;

      if (row.reason === '') errors.push('El motivo es obligatorio.');
      else if (row.reason.length > REASON_MAX) errors.push(`El motivo no puede superar ${REASON_MAX} caracteres.`);

      return variantId ? { display, variantId } : { display };
    });
  }

  private toPreview(locationId: string, occurredAt: string | undefined, resolved: ResolvedRow[]): BulkReceiptPreview {
    const rows = resolved.map((row) => row.display);
    const valid = rows.filter((row) => row.errors.length === 0);
    return {
      locationId,
      occurredAt: occurredAt ?? null,
      rows,
      totalRows: rows.length,
      validRows: valid.length,
      invalidRows: rows.length - valid.length,
      totalQuantity: valid.reduce((sum, row) => sum + (row.quantity ?? 0), 0),
    };
  }
}
