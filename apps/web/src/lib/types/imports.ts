/**
 * Mirrors the DTOs under `apps/api/src/import/` — the real staged Excel import pipeline
 * (ADR-0027 / ADR-0029, database.md#excel-import-pipeline). Kept local to the frontend, the same
 * convention as `lib/types/catalog.ts` / `lib/types/sales.ts`.
 *
 * Endpoints (all tenant-scoped — `tenantId` resolved server-side, never sent; every route gated by
 * `import.execute`; `import.inventory` is additionally required, service-side, only to confirm an
 * `update_catalog_and_inventory` job):
 *  - `GET  /api/v1/imports/template?categoryId?`          → binary .xlsx (download link, not JSON)
 *  - `POST /api/v1/imports`                               → multipart: `file` + optional text fields
 *  - `GET  /api/v1/imports?page&pageSize&status?`         → PaginatedResult<ImportJob>
 *  - `GET  /api/v1/imports/:id`                           → ImportJob
 *  - `POST /api/v1/imports/:id/mapping`                   → SetMappingInput
 *  - `POST /api/v1/imports/:id/validate` | `/confirm` | `/cancel`  → ImportJob
 *  - `GET  /api/v1/imports/:id/preview`                   → ImportPreview
 *  - `GET  /api/v1/imports/:id/rows?page&pageSize&status?`→ PaginatedResult<ImportJobRow>
 *  - `GET  /api/v1/imports/:id/errors?includeWarnings=`   → binary .xlsx (download link)
 *  - `GET/POST/PATCH/DELETE /api/v1/import-mapping-templates[/:id]`
 *
 * There is **no** progress percentage / processedRows / SSE / progress endpoint anywhere in the
 * contract (`GAP-IMPORT-PROGRESS`) — only `status` + the counters below. There is **no** endpoint
 * that returns an uploaded file's parsed column headers (`GAP-IMPORT-FILE-HEADERS`).
 */

// --- job status -----------------------------------------------------------------------------

export const IMPORT_JOB_STATUSES = [
  'uploaded',
  'mapping',
  'validating',
  'ready',
  'importing',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export const IMPORT_JOB_STATUS_LABELS: Record<ImportJobStatus, string> = {
  uploaded: 'Uploaded',
  mapping: 'Mapping',
  validating: 'Validating',
  ready: 'Ready to import',
  importing: 'Importing',
  completed: 'Completed',
  completed_with_errors: 'Completed with errors',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** A neutral fallback for a status the backend adds later — never assume "unknown" means error. */
export function importJobStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'completed_with_errors':
    case 'validating':
    case 'importing':
    case 'ready':
      return 'warning';
    case 'failed':
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** The two non-terminal statuses whose work happens outside the request (large files run on the
 * Import Worker) — the only ones the detail page lightly auto-refreshes for. */
export function isImportJobProcessing(status: string): boolean {
  return status === 'validating' || status === 'importing';
}

export function isImportJobTerminal(status: string): boolean {
  return status === 'completed' || status === 'completed_with_errors' || status === 'cancelled';
}

// --- duplicate-handling mode --------------------------------------------------------------------

export const DUPLICATE_HANDLING_MODES = [
  'update_catalog_only',
  'update_catalog_and_inventory',
  'skip_existing',
  'reject_on_duplicate',
] as const;
export type DuplicateHandlingMode = (typeof DUPLICATE_HANDLING_MODES)[number];

export const DUPLICATE_HANDLING_MODE_LABELS: Record<DuplicateHandlingMode, string> = {
  update_catalog_only: 'Update catalog only (safe default — stock untouched)',
  update_catalog_and_inventory: 'Update catalog and inventory (needs the import-inventory permission)',
  skip_existing: 'Skip rows whose SKU already exists',
  reject_on_duplicate: 'Reject the row if its SKU already exists',
};

/** `import.inventory` is the extra permission the backend checks at confirm time for this mode. */
export const INVENTORY_DUPLICATE_MODE: DuplicateHandlingMode = 'update_catalog_and_inventory';

// --- row status -----------------------------------------------------------------------------

export const IMPORT_ROW_STATUSES = ['pending', 'valid', 'warning', 'invalid', 'imported', 'skipped'] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export const IMPORT_ROW_STATUS_LABELS: Record<ImportRowStatus, string> = {
  pending: 'Pending',
  valid: 'Valid',
  warning: 'Warning',
  invalid: 'Invalid',
  imported: 'Imported',
  skipped: 'Skipped',
};

export function importRowStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'valid':
    case 'imported':
      return 'success';
    case 'warning':
      return 'warning';
    case 'invalid':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const IMPORT_MATCH_ACTION_LABELS: Record<string, string> = {
  create: 'New product',
  update: 'Existing product',
  skip: 'Skipped',
};

// --- target fields (columnMapping values) ---------------------------------------------------

/** `apps/api/src/import/import-fields.ts` `STANDARD_IMPORT_FIELDS` — the fixed vocabulary a mapping
 * value may point at, besides an `attr:<code>` dynamic-attribute target. */
export const STANDARD_IMPORT_FIELDS = [
  'sku',
  'name',
  'category',
  'brand',
  'supplier',
  'description',
  'unit',
  'barcode',
  'cost',
  'maxPrice',
  'basePrice',
  'minPrice',
  'quantity',
  'location',
  'productRef',
  'serialNumber',
  'lotNumber',
  'manufacturedDate',
  'expiryDate',
] as const;
export type StandardImportField = (typeof STANDARD_IMPORT_FIELDS)[number];

export const ATTRIBUTE_FIELD_PREFIX = 'attr:';

export function isKnownImportTarget(field: string): boolean {
  return field.startsWith(ATTRIBUTE_FIELD_PREFIX) || (STANDARD_IMPORT_FIELDS as readonly string[]).includes(field);
}

/** Client mirror of `assertValidColumnMapping` — returns a user-facing reason or `null` if valid.
 * The backend re-validates; this only keeps the template form / upload form honest up front. */
export function columnMappingProblem(mapping: Record<string, string>): string | null {
  const entries = Object.entries(mapping);
  if (entries.length === 0) return 'Map at least one column.';
  const unknown = entries.filter(([, target]) => !isKnownImportTarget(target)).map(([, t]) => t);
  if (unknown.length > 0) return `Unknown target field(s): ${unknown.join(', ')}.`;
  const nonAttr = entries.map(([, t]) => t).filter((t) => !t.startsWith(ATTRIBUTE_FIELD_PREFIX));
  const dup = nonAttr.filter((t, i) => nonAttr.indexOf(t) !== i);
  if (dup.length > 0) return `Mapped more than once: ${[...new Set(dup)].join(', ')}.`;
  if (!entries.some(([, t]) => t === 'sku')) return 'One column must map to "sku".';
  return null;
}

/** The header→field pairs `ImportTemplateService` (`import-template.service.ts` `BASE_COLUMNS`)
 * writes into the downloadable template. Offered in the upload form as "I filled in the downloaded
 * template" — the same module's own generator output, not an invented contract. */
export const STANDARD_TEMPLATE_MAPPING: Record<string, string> = {
  SKU: 'sku',
  Nombre: 'name',
  Categoria: 'category',
  Marca: 'brand',
  Proveedor: 'supplier',
  Descripcion: 'description',
  Unidad: 'unit',
  'Codigo de Barras': 'barcode',
  Costo: 'cost',
  'Precio maximo': 'maxPrice',
  'Precio base': 'basePrice',
  'Precio minimo': 'minPrice',
  Cantidad: 'quantity',
  Ubicacion: 'location',
  'Referencia de Producto': 'productRef',
  'Numero de Serie': 'serialNumber',
  'Numero de Lote': 'lotNumber',
  'Fecha de Fabricacion (AAAA-MM-DD)': 'manufacturedDate',
  'Fecha de Vencimiento (AAAA-MM-DD)': 'expiryDate',
};

// --- DTOs ----------------------------------------------------------------------------------------

/** One structured validation finding on a row (`ImportRowIssueDto`) — written for the end user;
 * safe to render as plain text (never `dangerouslySetInnerHTML`). */
export interface ImportRowIssue {
  field: string;
  code: string;
  message: string;
}

/** `GET /imports` list item / `GET /imports/:id` / every mutation response — `ImportJobResponseDto`. */
export interface ImportJob {
  id: string;
  status: string;
  originalFilename: string;
  duplicateHandlingMode: string;
  defaultLocationId?: string;
  mappingTemplateId?: string;
  columnMapping: Record<string, string>;
  totalRows?: number;
  validRows?: number;
  invalidRows?: number;
  warningRows?: number;
  importedRows?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** `GET /imports/:id/rows` item — `ImportJobRowResponseDto`. */
export interface ImportJobRow {
  rowNumber: number;
  status: string;
  matchAction?: string;
  matchedProductVariantId?: string;
  rawData: Record<string, unknown>;
  mappedData?: Record<string, unknown>;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
}

/** `GET /imports/:id/preview` — `ImportPreviewResponseDto`. All real counters; no percentage. */
export interface ImportPreview {
  status: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  warningRows: number;
  importedRows: number;
  pendingRows: number;
  skippedRows: number;
  newProducts: number;
  existingProducts: number;
}

/** `POST /imports` — the text fields alongside the multipart `file` part. No `tenantId`. */
export interface CreateImportInput {
  file: File;
  mappingTemplateId?: string;
  columnMapping?: Record<string, string>;
  defaultLocationId?: string;
  duplicateHandlingMode?: DuplicateHandlingMode;
}

/** `POST /imports/:id/mapping` — `SetMappingDto` (exactly one of template/mapping). */
export interface SetMappingInput {
  mappingTemplateId?: string;
  columnMapping?: Record<string, string>;
  defaultLocationId?: string;
  duplicateHandlingMode?: DuplicateHandlingMode;
}

/** `MappingTemplateResponseDto`. */
export interface MappingTemplate {
  id: string;
  name: string;
  categoryId?: string;
  columnMapping: Record<string, string>;
  createdAt: string;
}

/** `POST /import-mapping-templates` — `CreateMappingTemplateDto`. */
export interface CreateMappingTemplateInput {
  name: string;
  categoryId?: string;
  columnMapping: Record<string, string>;
}

/** `PATCH /import-mapping-templates/:id` — `UpdateMappingTemplateDto` (every field optional). */
export interface UpdateMappingTemplateInput {
  name?: string;
  categoryId?: string;
  columnMapping?: Record<string, string>;
}

// --- pipeline gating (mirror of import-job-state-machine.ts) -----------------------------------

/**
 * Which staged actions the backend allows from `status`. The backend re-checks the transition +
 * permission on every call (`assertTransition`, `ImportJobService`) — this only decides which
 * controls to render.
 *  - `setMapping`  : `uploaded` / `mapping` / `ready`  (→ `mapping`)
 *  - `validate`    : `mapping` (→ `validating`); or a `failed` job that never finished validation
 *  - `confirm`     : `ready` (→ `importing`); or a `failed` job that already finished validation
 *  - `cancel`      : `uploaded` / `mapping` / `validating` / `ready` / `failed`
 * `failedNeedsValidate` distinguishes the two `failed` retry routes: a job with no `totalRows` yet
 * never completed validation → retry via validate; otherwise → retry via confirm
 * (`ImportJobService.triggerValidate` / `.triggerConfirm` guards).
 */
export function importPipelineActions(job: { status: string; totalRows?: number | null | undefined }): {
  setMapping: boolean;
  validate: boolean;
  confirm: boolean;
  cancel: boolean;
} {
  const s = job.status;
  const failedNeedsValidate = s === 'failed' && (job.totalRows === undefined || job.totalRows === null);
  const failedNeedsConfirm = s === 'failed' && !failedNeedsValidate;
  return {
    setMapping: s === 'uploaded' || s === 'mapping' || s === 'ready',
    validate: s === 'mapping' || failedNeedsValidate,
    confirm: s === 'ready' || failedNeedsConfirm,
    cancel: s === 'uploaded' || s === 'mapping' || s === 'validating' || s === 'ready' || s === 'failed',
  };
}

/** Whether the "download error report" link is worth showing — any invalid rows, or a job that
 * ended in a state that implies findings. The `/errors` endpoint generates the report on demand. */
export function importHasErrorReport(job: {
  status: string;
  invalidRows?: number | null | undefined;
  warningRows?: number | null | undefined;
}): boolean {
  return (
    (job.invalidRows ?? 0) > 0 ||
    (job.warningRows ?? 0) > 0 ||
    job.status === 'completed_with_errors' ||
    job.status === 'failed'
  );
}
