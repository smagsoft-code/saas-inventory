import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listQrCodes } from '../../../lib/catalog/qr-codes';
import { listProductCatalog } from '../../../lib/catalog/product-catalog';
import { listCategories } from '../../../lib/catalog/categories';
import { buildLocationIndex, shortId } from '../../../lib/inventory/location-index';
import { apiPublicUrl } from '../../../lib/api/public-url';
import {
  QR_STATUSES,
  QR_TARGET_TYPES,
  QR_TARGET_TYPE_LABELS,
  isQrExpired,
  qrStatusTone,
  type QrCode,
  type QrStatus,
  type QrTargetType,
} from '../../../lib/types/qr';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { QrThumbnailModal } from '../../../components/qr-thumbnail-modal';
import { QrFilters } from './qr-filters';
import { RevokeQrButton } from './revoke-qr-button';

export const metadata = { title: 'Códigos QR · SaaS Inventory' };

const PAGE_SIZE = 20;

const QR_STATUS_LABELS: Record<string, string> = { active: 'Activo', revoked: 'Revocado' };

function pick<T extends string>(allowed: readonly T[], value: string | undefined): T | undefined {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : undefined;
}

/**
 * `S-QR-LIST` — `GET /api/v1/qr-codes` (`catalog.qr.manage`). Search bar + filters (`QrFilters`):
 * `categoryId` reuses the same product-catalog concept `/products` filters by; `status` here is the
 * QR code's own lifecycle (`active`/`revoked`) — genuinely different from `/products`' variant
 * status, so it is its own filter, not a relabeled copy. No stock filter (a product/inventory
 * concept, unrelated to which QR codes exist).
 *
 * Three fetch modes:
 *  - No filter at all: unchanged — real backend pagination via `listQrCodes`, plus a bounded
 *    (`pageSize: 100`) unfiltered `product-catalog` fetch purely for name/price enrichment (the
 *    mirror image of `/products`' own bounded QR-code fetch for its QR column).
 *  - `q`/`categoryId` set (product-shaped — only ever matches `product_variant` targets): the
 *    matching variant set comes from a bounded, filtered `product-catalog` fetch, cross-referenced
 *    against a bounded (`pageSize: 100`) `product_variant` QR pool. `status` (if also set) narrows
 *    that further.
 *  - Only `status` set (no `q`/`categoryId` — applies to every target type, `location` included):
 *    a bounded (`pageSize: 100`) `listQrCodes` pool for the current tab, filtered locally by
 *    `qr.status`. `GAP-QR-FILTER-BOUNDED`: any filtered mode here is bounded to the first 100 rows
 *    tenant-wide, the same convention already accepted for `GAP-VARIANT-LIST`/`buildLocationIndex`.
 */
export default async function QrCodesPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    targetType?: string;
    q?: string;
    categoryId?: string;
    status?: string;
  }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('catalog.qr.manage')) {
    return (
      <PageContainer>
        <PageHeader title="Códigos QR" />
        <NoAccess message="Necesitas el permiso de gestión de QR para ver esta página." />
      </PageContainer>
    );
  }

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const targetType = pick(QR_TARGET_TYPES, sp.targetType);
  const q = sp.q?.trim() || undefined;
  const categoryId = sp.categoryId || undefined;
  const qrStatus = pick(QR_STATUSES, sp.status);

  const canViewProducts = checker.can('products.view');
  const canViewCategories = checker.can('categories.view');

  const hasCatalogFilter = Boolean(q || categoryId);
  const hasAnyFilter = hasCatalogFilter || Boolean(qrStatus);

  const publicUrl = apiPublicUrl();

  const [index, categories] = await Promise.all([
    buildLocationIndex(checker.can('warehouses.view')),
    canViewCategories ? listCategories({ pageSize: 100 }).catch(() => null) : Promise.resolve(null),
  ]);

  const productNameByVariant = new Map<string, string>();
  const skuByVariant = new Map<string, string>();
  const maxPriceByVariant = new Map<string, number>();

  function paginate(all: QrCode[]): { rows: QrCode[]; meta: { page: number; pageSize: number; total: number; totalPages: number } } {
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const clampedPage = Math.min(page, totalPages);
    return {
      rows: all.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE),
      meta: { page: clampedPage, pageSize: PAGE_SIZE, total, totalPages },
    };
  }

  let rows: QrCode[];
  let meta: { page: number; pageSize: number; total: number; totalPages: number };

  if (hasCatalogFilter && canViewProducts) {
    const [matchingCatalog, qrPool] = await Promise.all([
      listProductCatalog({ pageSize: 100, ...(q ? { q } : {}), ...(categoryId ? { categoryId } : {}) }).catch(() => null),
      listQrCodes({ targetType: 'product_variant', pageSize: 100 }).catch(() => null),
    ]);
    for (const row of matchingCatalog?.data ?? []) {
      productNameByVariant.set(row.variantId, row.productName);
      skuByVariant.set(row.variantId, row.sku);
      maxPriceByVariant.set(row.variantId, row.maxPrice);
    }
    const matchingVariantIds = new Set(productNameByVariant.keys());
    const filtered = (qrPool?.data ?? []).filter(
      (qr) => matchingVariantIds.has(qr.targetId) && (!qrStatus || qr.status === qrStatus),
    );
    ({ rows, meta } = paginate(filtered));
  } else if (qrStatus) {
    const [qrPool, catalogForNames] = await Promise.all([
      listQrCodes({ pageSize: 100, ...(targetType ? { targetType } : {}) }).catch(() => null),
      canViewProducts ? listProductCatalog({ pageSize: 100 }).catch(() => null) : Promise.resolve(null),
    ]);
    for (const row of catalogForNames?.data ?? []) {
      productNameByVariant.set(row.variantId, row.productName);
      skuByVariant.set(row.variantId, row.sku);
      maxPriceByVariant.set(row.variantId, row.maxPrice);
    }
    const filtered = (qrPool?.data ?? []).filter((qr) => qr.status === qrStatus);
    ({ rows, meta } = paginate(filtered));
  } else {
    const [result, catalogForNames] = await Promise.all([
      listQrCodes({ page, pageSize: PAGE_SIZE, ...(targetType ? { targetType } : {}) }),
      canViewProducts ? listProductCatalog({ pageSize: 100 }).catch(() => null) : Promise.resolve(null),
    ]);
    for (const row of catalogForNames?.data ?? []) {
      productNameByVariant.set(row.variantId, row.productName);
      skuByVariant.set(row.variantId, row.sku);
      maxPriceByVariant.set(row.variantId, row.maxPrice);
    }
    rows = result.data;
    meta = result.meta;
  }

  function targetLabel(qr: QrCode): string {
    if (qr.targetType === 'location') {
      return index.locationName(qr.targetId);
    }
    return productNameByVariant.get(qr.targetId) ?? `Variante ${shortId(qr.targetId)}`;
  }

  function buildHref(next: {
    page?: number;
    targetType?: QrTargetType | undefined;
  }): string {
    const params = new URLSearchParams();
    const nextType = 'targetType' in next ? next.targetType : targetType;
    if (nextType) params.set('targetType', nextType);
    if (q) params.set('q', q);
    if (categoryId) params.set('categoryId', categoryId);
    if (qrStatus) params.set('status', qrStatus);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/qr${params.toString() ? `?${params}` : ''}`;
  }

  return (
    <PageContainer>
      <PageHeader
        title="Códigos QR"
        description="Códigos imprimibles que resuelven a una variante de producto o a un almacén."
        actions={<ButtonLink href="/qr/new">Generar código QR</ButtonLink>}
      />

      <QrFilters
        initial={{ q, categoryId, status: qrStatus as QrStatus | undefined }}
        categories={(categories?.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
      />
      {hasCatalogFilter && targetType !== 'product_variant' && (
        <p className="text-xs text-slate-500">
          La búsqueda y la categoría no aplican a los códigos de almacén — cámbiate a
          &quot;Variante de producto&quot; para verlos junto a los demás resultados.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={
            hasAnyFilter
              ? 'Ningún código QR coincide con estos filtros'
              : targetType
                ? 'No hay códigos QR para este tipo de destino'
                : 'Aún no hay códigos QR'
          }
          description={
            hasAnyFilter
              ? 'Prueba con otra búsqueda, categoría o estado.'
              : targetType
                ? 'Prueba con otro tipo de destino, o quita el filtro.'
                : 'Genera un código para vincular una etiqueta impresa a una variante o a un almacén.'
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Código</TH>
                <TH>Nombre</TH>
                <TH>Tipo</TH>
                <TH>Estado</TH>
                <TH>Vence</TH>
                <TH>QR</TH>
                <TH className="w-0">
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((qr) => {
                const expired = isQrExpired(qr);
                const label = targetLabel(qr);
                const sku = qr.targetType === 'product_variant' ? skuByVariant.get(qr.targetId) : undefined;
                const maxPrice = qr.targetType === 'product_variant' ? maxPriceByVariant.get(qr.targetId) : undefined;
                const qrValue = `${publicUrl.replace(/\/$/, '')}/q/${qr.code}`;
                return (
                  <TR key={qr.id}>
                    <TD>
                      <code className="text-xs text-slate-700">{qr.code}</code>
                    </TD>
                    <TD className="text-slate-700">
                      {label}
                      {sku && <span className="ml-1 text-xs text-slate-400">({sku})</span>}
                    </TD>
                    <TD className="text-slate-500">
                      {QR_TARGET_TYPE_LABELS[qr.targetType as QrTargetType] ?? qr.targetType}
                    </TD>
                    <TD>
                      <Badge tone={qrStatusTone(qr.status)}>{QR_STATUS_LABELS[qr.status] ?? qr.status}</Badge>
                      {expired && qr.status === 'active' && (
                        <Badge tone="warning" className="ml-2">
                          vencido
                        </Badge>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-slate-500">
                      {qr.expiresAt ? new Date(qr.expiresAt).toLocaleDateString() : '—'}
                    </TD>
                    <TD>
                      <QrThumbnailModal
                        value={qrValue}
                        label={sku ? `${label} — ${sku}` : label}
                        {...(typeof maxPrice === 'number' ? { maxPrice } : {})}
                      />
                    </TD>
                    <TD>
                      {qr.status === 'active' ? (
                        <RevokeQrButton id={qr.id} />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pagination
            page={meta.page}
            pageSize={meta.pageSize}
            total={meta.total}
            totalPages={meta.totalPages}
            buildHref={(nextPage) => buildHref({ page: nextPage })}
          />
        </>
      )}
    </PageContainer>
  );
}
