import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listProductCatalog } from '../../../lib/catalog/product-catalog';
import { listCategories } from '../../../lib/catalog/categories';
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
import { ProductsFilters } from './products-filters';
import { ProductsCatalogTable } from './products-catalog-table';

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
  searchParams: Promise<{ page?: string; q?: string; categoryId?: string; status?: string; stock?: string }>;
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

  const [result, categories, qrCodes, locationIndex] = await Promise.all([
    listProductCatalog({
      page,
      pageSize: PAGE_SIZE,
      ...(q ? { q } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(status ? { status } : {}),
      ...(stock ? { stock } : {}),
    }),
    canViewCategories ? listCategories({ pageSize: 100 }) : Promise.resolve(null),
    canViewQr ? listQrCodes({ targetType: 'product_variant', pageSize: 100 }).catch(() => null) : Promise.resolve(null),
    canViewInventory ? buildLocationIndex(checker.can('warehouses.view')) : Promise.resolve(null),
  ]);
  const categoryNames = new Map<string, string>((categories?.data ?? []).map((c) => [c.id, c.name]));
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

  function buildHref(next: { page?: number }): string {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (categoryId) params.set('categoryId', categoryId);
    if (urlStatus) params.set('status', urlStatus);
    if (stock) params.set('stock', stock);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/products${params.toString() ? `?${params}` : ''}`;
  }

  // `active` — explicit or (more often) the untouched default — is not a real filter; only a
  // genuine deviation from it (`discontinued`, or explicitly `all`) should count as one.
  const hasFilter = Boolean(q || categoryId || (urlStatus && urlStatus !== 'active') || stock);

  return (
    <PageContainer>
      <PageHeader
        title="Productos"
        description="El catálogo. Cada fila es una variante (código); un producto puede tener varias."
        actions={canManage ? <ButtonLink href="/products/new">Nuevo producto</ButtonLink> : undefined}
      />

      <ProductsFilters
        initial={{ q, categoryId, status: urlStatus, stock }}
        categories={(categories?.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
      />

      {result.data.length === 0 ? (
        hasFilter ? (
          <EmptyState title="Ningún producto coincide con estos filtros" description="Prueba con otra búsqueda, categoría, estado o stock." />
        ) : (
          <EmptyState
            title="Aún no hay productos"
            description="Crea tu primer producto para empezar a construir el catálogo."
            action={canManage ? <ButtonLink href="/products/new">Nuevo producto</ButtonLink> : undefined}
          />
        )
      ) : (
        <>
          <ProductsCatalogTable
            rows={result.data}
            categoryNames={categoryNames}
            qrValueByVariant={qrValueByVariant}
            canManage={canManage}
            canViewInventory={canViewInventory}
            locationNames={locationNames}
            locationWarehouseNames={locationWarehouseNames}
          />
          <Pagination
            page={result.meta.page}
            pageSize={result.meta.pageSize}
            total={result.meta.total}
            totalPages={result.meta.totalPages}
            buildHref={(nextPage) => buildHref({ page: nextPage })}
          />
        </>
      )}
    </PageContainer>
  );
}
