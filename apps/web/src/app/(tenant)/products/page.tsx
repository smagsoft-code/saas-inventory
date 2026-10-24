import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { buildProductCatalogExportHref, listProductCatalog } from '../../../lib/catalog/product-catalog';
import { fetchAllPages } from '../../../lib/fetch-all';
import { ListViewControls } from '../../../components/list-view-controls';
import { listCategories } from '../../../lib/catalog/categories';
import { getAttributeOptions, listAttributeDefinitions, listMeasurementUnits } from '../../../lib/catalog/attributes';
import { buildAttributeSummaryFromDefinitions, formatAttributeSummaryLine } from '../../../lib/catalog/attribute-summary';
import { listQrCodes } from '../../../lib/catalog/qr-codes';
import { buildLocationIndex } from '../../../lib/inventory/location-index';
import { apiPublicUrl } from '../../../lib/api/public-url';
import {
  PRODUCT_CATALOG_STATUSES,
  PRODUCT_CATALOG_STOCK_FILTERS,
  type ProductCatalogStatus,
  type ProductCatalogStockFilter,
} from '../../../lib/types/product-catalog';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { getInventorySummary } from '../../../lib/inventory/reports';
import { ProductsFilters } from './products-filters';
import { ProductsCatalogTable } from './products-catalog-table';
import { ProductsChips, ProductsKpis, ProductsMobileList, type ProductsChip, type ProductsKpiData } from './products-mobile';

export const metadata = { title: 'Productos · SaaS Inventory' };

const PAGE_SIZE = 20;

type UrlStatus = ProductCatalogStatus | 'all';

/** The literal `?status=` value, when it's one this page recognizes — `undefined` means the owner
 * never touched the filter (as opposed to explicitly picking "Todos", its own `all` value). Kept
 * separate from the value actually sent to the API so pagination links can preserve an explicit
 * "Todos" instead of silently reverting to the default on page 2. */
function parseUrlStatus(value: string | undefined): UrlStatus | undefined {
  return value === 'all' || (PRODUCT_CATALOG_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as UrlStatus)
    : undefined;
}

/** `undefined` (never touched) defaults to `'active'` — hiding descontinuadas (desactivadas) is
 * the sensible default so a deactivated variant stops showing up in the catalog on its own; the
 * explicit `'all'` choice is what actually asks for every status, mapped here to "no filter". */
function toQueryStatus(urlStatus: UrlStatus | undefined): ProductCatalogStatus | undefined {
  return urlStatus === 'all' ? undefined : (urlStatus ?? 'active');
}
function parseStock(value: string | undefined): ProductCatalogStockFilter | undefined {
  return (PRODUCT_CATALOG_STOCK_FILTERS as readonly string[]).includes(value ?? '') ? (value as ProductCatalogStockFilter) : undefined;
}

/**
 * Product list (`S-CAT-PRODUCTS`, OUI-004 redesign) — `GET /api/v1/reports/product-catalog`
 * (`products.view`), variant-grain, offset paginated. Real filters: `q` (substring on product name
 * OR SKU), `categoryId`, `status` (the variant's own), `stock` (`with` = available > 1, `without`
 * = exactly 0) — see the endpoint's own doc comment for why this cross-domain (CATALOG + INVENTORY)
 * read lives under `/reports/`. Category names and QR-code presence resolve from their own bounded
 * (`pageSize: 100`) fetches, the same convention every other enrichment in this app uses.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; categoryId?: string; status?: string; stock?: string; all?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('products.view')) {
    return (
      <PageContainer>
        <PageHeader title="Productos" />
        <NoAccess message="Necesitas el permiso de productos para ver esta página." />
      </PageContainer>
    );
  }
  const canManage = checker.can('products.manage');
  const canViewCategories = checker.can('categories.view');
  const canViewQr = checker.can('catalog.qr.manage');
  const canViewInventory = checker.can('inventory.view');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim() || undefined;
  const categoryId = sp.categoryId || undefined;
  const urlStatus = parseUrlStatus(sp.status);
  const status = toQueryStatus(urlStatus);
  const stock = parseStock(sp.stock);
  // "Ver todos": every matching variant on screen instead of one page.
  const showAll = sp.all === '1';
  const catalogFilters = {
    ...(q ? { q } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(status ? { status } : {}),
    ...(stock ? { stock } : {}),
  };

  const [result, categories, qrCodes, locationIndex] = await Promise.all([
    showAll
      ? fetchAllPages((p, size) => listProductCatalog({ ...catalogFilters, page: p, pageSize: size })).then((all) => ({
          data: all.data,
          meta: { page: 1, pageSize: Math.max(all.data.length, PAGE_SIZE), total: all.total, totalPages: 1 },
          truncated: all.truncated,
        }))
      : listProductCatalog({ ...catalogFilters, page, pageSize: PAGE_SIZE }).then((paged) => ({ ...paged, truncated: false })),
    canViewCategories ? listCategories({ pageSize: 100 }) : Promise.resolve(null),
    canViewQr ? listQrCodes({ targetType: 'product_variant', pageSize: 100 }).catch(() => null) : Promise.resolve(null),
    canViewInventory ? buildLocationIndex(checker.can('warehouses.view')) : Promise.resolve(null),
  ]);
  const categoryNames = new Map<string, string>((categories?.data ?? []).map((c) => [c.id, c.name]));

  // "Color: Crema; Medidas: 80 cm" under each product name: attribute names, option labels and units
  // come from the (bounded) definitions list, resolved here so only plain strings reach the table.
  // Cosmetic — if any lookup fails the table simply shows no attribute line.
  const attributeLineByVariant = new Map<string, string>();
  if (result.data.some((row) => row.attributes)) {
    try {
      const [definitions, units] = await Promise.all([listAttributeDefinitions(), listMeasurementUnits()]);
      const selectDefinitions = definitions.filter((d) => d.dataType === 'select' || d.dataType === 'multi_select');
      const optionEntries = await Promise.all(
        selectDefinitions.map(async (d) => [d.id, await getAttributeOptions(d.id)] as const),
      );
      const options = Object.fromEntries(optionEntries);
      for (const row of result.data) {
        if (!row.attributes) continue;
        const line = formatAttributeSummaryLine(
          buildAttributeSummaryFromDefinitions({ definitions, options, units, values: row.attributes }),
        );
        if (line) attributeLineByVariant.set(row.variantId, line);
      }
    } catch {
      attributeLineByVariant.clear();
    }
  }
  // OUI-008: the real scannable value, not just presence — a plain string per variant, so it can
  // cross the RSC boundary into the Client Component table below. `status === 'active'` only — a
  // revoked QR must never keep showing the thumbnail (a revoked code 404s if actually scanned);
  // "vigente" here is exactly `/qr`'s own definition (the row's `status` field), never inferred
  // from mere presence of a qr_codes row (bulk-QR sync fix).
  const publicUrl = apiPublicUrl();
  const qrValueByVariant = new Map<string, string>(
    (qrCodes?.data ?? [])
      .filter((qr) => qr.status === 'active')
      .map((qr) => [qr.targetId, `${publicUrl}/q/${qr.code}`]),
  );
  // ProductsCatalogTable is a Client Component — `locationIndex` (LocationIndex) carries functions,
  // which React refuses to serialize across the Server -> Client boundary ("Functions cannot be
  // passed directly to Client Components"). Its `locationName`/`warehouseName` are called HERE,
  // server-side, and only the resulting plain Maps cross the boundary.
  const locationNames = new Map<string, string>((locationIndex?.locations ?? []).map((l) => [l.id, l.name]));
  const locationWarehouseNames = new Map<string, string>(
    (locationIndex?.locations ?? []).map((l) => [l.id, locationIndex!.warehouseName(l.id)]),
  );

  /** The list URL with the current filters. `without` drops one filter (a removable chip); `status`
   * forces the status param (`null` = back to the default). */
  function buildHref(next: { page?: number; all?: boolean; without?: 'categoryId' | 'stock'; status?: string | null }): string {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (categoryId && next.without !== 'categoryId') params.set('categoryId', categoryId);
    const nextStatus = next.status === undefined ? urlStatus : next.status;
    if (nextStatus) params.set('status', nextStatus);
    if (stock && next.without !== 'stock') params.set('stock', stock);
    if (next.all) params.set('all', '1');
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/products${params.toString() ? `?${params}` : ''}`;
  }

  // --- phone version: KPI tiles + active-filter chips -----------------------------------------------
  // Stock figures are tenant-wide live reads; a caller without inventory.view (or a failed read)
  // gets "—", never a 0.
  const [inventorySummary, withoutStock] = canViewInventory
    ? await Promise.all([
        getInventorySummary({ groupBy: 'warehouse' }).catch(() => null),
        listProductCatalog({ status: 'active', stock: 'without', pageSize: 1 }).catch(() => null),
      ])
    : [null, null];
  const available = inventorySummary?.totals.availableQuantity;
  const reserved = inventorySummary?.totals.reservedQuantity ?? 0;
  const statusChipLabel = urlStatus === 'all' ? undefined : urlStatus === 'discontinued' ? 'Desactivados' : 'Activos';
  const kpis: ProductsKpiData = {
    totalModels: result.meta.total,
    totalStock: available ?? null,
    availablePercent: available === undefined || available + reserved <= 0 ? null : Math.round((available / (available + reserved)) * 100),
    outOfStockCount: withoutStock ? withoutStock.meta.total : null,
    firstOutOfStockSku: withoutStock?.data[0]?.sku,
    modelsCaption: statusChipLabel ?? 'Todos los estados',
  };
  // One chip per filter of the panel (the search text lives in the search box, not here), so the
  // "Filtro (n)" count and these chips are always the same set.
  const chips: ProductsChip[] = [
    ...(statusChipLabel ? [{ key: 'status', label: statusChipLabel, removeHref: buildHref({ status: urlStatus === 'discontinued' ? null : 'all' }), tone: 'accent' as const }] : []),
    ...(categoryId ? [{ key: 'category', label: categoryNames.get(categoryId) ?? 'Categoría', removeHref: buildHref({ without: 'categoryId' }), tone: 'alt' as const }] : []),
    ...(stock ? [{ key: 'stock', label: stock === 'with' ? 'Con stock' : 'Sin stock', removeHref: buildHref({ without: 'stock' }), tone: 'accent' as const }] : []),
  ];

  // `active` — explicit or (more often) the untouched default — is not a real filter; only a
  // genuine deviation from it (`discontinued`, or explicitly `all`) should count as one.
  const hasFilter = Boolean(q || categoryId || (urlStatus && urlStatus !== 'active') || stock);

  const filtersEl = (
    <ProductsFilters
      initial={{ q, categoryId, status: urlStatus, stock }}
      categories={(categories?.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
      showAll={showAll}
    />
  );
  const emptyEl =
    result.data.length === 0 ? (
      hasFilter ? (
        <EmptyState title="Ningún producto coincide con estos filtros" description="Prueba con otra búsqueda, categoría, estado o stock." />
      ) : (
        <EmptyState
          title="Aún no hay productos"
          description="Crea tu primer producto para empezar a construir el catálogo."
          action={canManage ? <ButtonLink href="/products/new">Nuevo producto</ButtonLink> : undefined}
        />
      )
    ) : null;
  const controlsEl = (
    <ListViewControls
      showingAll={showAll}
      allHref={buildHref({ all: true })}
      pagedHref={buildHref({})}
      shown={result.data.length}
      total={result.meta.total}
      truncated={result.truncated}
      canToggle={result.meta.total > PAGE_SIZE}
      excelHref={buildProductCatalogExportHref(catalogFilters, 'xlsx')}
      pdfHref={buildProductCatalogExportHref(catalogFilters, 'pdf')}
    />
  );
  const paginationEl = (
    <Pagination
      page={result.meta.page}
      pageSize={result.meta.pageSize}
      total={result.meta.total}
      totalPages={result.meta.totalPages}
      buildHref={(nextPage) => buildHref({ page: nextPage })}
    />
  );

  return (
    <PageContainer>
      <PageHeader
        title="Productos"
        help="El catálogo. Cada fila es una variante (código); un producto puede tener varias."
        actions={canManage ? <ButtonLink href="/products/new">Nuevo producto</ButtonLink> : undefined}
      />

      {/* Phones: KPI tiles, search + filters, active-filter chips and expandable cards. */}
      <div className="flex flex-col gap-4 md:hidden">
        <ProductsKpis data={kpis} />
        {filtersEl}
        <ProductsChips chips={chips} />
        {emptyEl ?? (
          <>
            <ProductsMobileList
              rows={result.data}
              total={result.meta.total}
              categoryNames={categoryNames}
              attributeLineByVariant={attributeLineByVariant}
              qrValueByVariant={qrValueByVariant}
              canManage={canManage}
              canViewInventory={canViewInventory}
              locationNames={locationNames}
              locationWarehouseNames={locationWarehouseNames}
            />
            {controlsEl}
            {paginationEl}
          </>
        )}
      </div>

      {/* Tablets and desktops keep the table (`md:contents` = no wrapper box, same page rhythm). */}
      <div className="hidden md:contents">
        {filtersEl}
        {emptyEl ?? (
          <>
            {controlsEl}
            <ProductsCatalogTable
              attributeLineByVariant={attributeLineByVariant}
              rows={result.data}
              categoryNames={categoryNames}
              qrValueByVariant={qrValueByVariant}
              canManage={canManage}
              canViewInventory={canViewInventory}
              locationNames={locationNames}
              locationWarehouseNames={locationWarehouseNames}
            />
            {paginationEl}
          </>
        )}
      </div>
    </PageContainer>
  );
}
