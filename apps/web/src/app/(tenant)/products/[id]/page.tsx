import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { serverApiFetch } from '../../../../lib/api/server';
import { getProduct, listProductVariants } from '../../../../lib/catalog/products';
import { listCategories, getCategory } from '../../../../lib/catalog/categories';
import { listAttributeDefinitions } from '../../../../lib/catalog/attributes';
import { loadCategoryAttributeFieldSets } from '../../../../lib/catalog/product-attributes';
import { PRODUCT_STATUS_LABELS, VARIANT_STATUS_LABELS, type ProductStatus, type VariantStatus } from '../../../../lib/types/products';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { Badge, statusTone } from '../../../../components/ui/badge';
import { ButtonLink } from '../../../../components/ui/button';
import { NoAccess } from '../../../../components/ui/no-access';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';
import { ProductForm } from '../product-form';

export const metadata = { title: 'Producto · SaaS Inventory' };

function formatPrice(value: number | undefined): string {
  return typeof value === 'number' ? value.toFixed(2) : '—';
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('products.view')) {
    return (
      <PageContainer>
        <PageHeader title="Producto" />
        <NoAccess message="Necesitas el permiso de productos para ver esta página." />
      </PageContainer>
    );
  }
  const canManage = checker.can('products.manage');
  const canViewCategories = checker.can('categories.view');

  let product;
  try {
    product = await getProduct(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const [variants, categories, definitions, category] = await Promise.all([
    listProductVariants(id),
    canManage && canViewCategories ? listCategories({ pageSize: 100, status: 'active' }) : Promise.resolve(null),
    canManage && canViewCategories ? listAttributeDefinitions() : Promise.resolve([]),
    product.categoryId && canViewCategories ? getCategory(product.categoryId).catch(() => null) : Promise.resolve(null),
  ]);

  const initialFieldSets =
    canManage && canViewCategories
      ? await loadCategoryAttributeFieldSets((path) => serverApiFetch(path), product.categoryId, definitions)
      : { product: [], variant: [], options: {} };

  const productAttrEntries = Object.entries(product.attributes ?? {});

  return (
    <PageContainer>
      <PageHeader
        title={product.name}
        description={category ? category.name : product.categoryId ? 'Categoría' : 'Sin categoría'}
        actions={
          <Badge tone={statusTone(product.status)}>
            {PRODUCT_STATUS_LABELS[product.status as ProductStatus] ?? product.status}
          </Badge>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Detalles</h2>
          {canManage && canViewCategories ? (
            <ProductForm
              mode="edit"
              product={product}
              categories={(categories?.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
              definitions={definitions}
              initialFieldSets={initialFieldSets}
            />
          ) : (
            <dl className="grid max-w-md grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Nombre</dt>
              <dd className="text-slate-900">{product.name}</dd>
              {product.description && (
                <>
                  <dt className="text-slate-500">Descripción</dt>
                  <dd className="text-slate-900">{product.description}</dd>
                </>
              )}
              <dt className="text-slate-500">Garantía</dt>
              <dd className="text-slate-900">
                {typeof product.warrantyMonths === 'number' ? `${product.warrantyMonths} meses` : '—'}
              </dd>
              {productAttrEntries.length > 0 && (
                <>
                  <dt className="text-slate-500">Atributos</dt>
                  <dd className="text-slate-900">
                    <ul className="flex flex-col gap-0.5">
                      {productAttrEntries.map(([key, value]) => (
                        <li key={key}>
                          <span className="text-slate-500">{key}:</span>{' '}
                          {Array.isArray(value) ? value.join(', ') : String(value)}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </>
              )}
              {(product.brandId || product.supplierId) && (
                <>
                  <dt className="text-slate-500">Marca / proveedor</dt>
                  <dd className="text-slate-500">
                    {/* GAP-BRAND-SUPPLIER-LIST: no endpoint to resolve these ids to names. */}
                    {product.brandId ? `marca ${product.brandId}` : '—'}
                    {product.supplierId ? ` · proveedor ${product.supplierId}` : ''}
                  </dd>
                </>
              )}
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Variantes</h2>
            {canManage && (
              <ButtonLink href={`/products/${product.id}/variants/new`} size="sm">
                Agregar variante
              </ButtonLink>
            )}
          </div>
          {variants.length === 0 ? (
            <p className="text-sm text-slate-500">Este producto no tiene variantes.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Código</TH>
                  <TH>Unidad</TH>
                  <TH>Base</TH>
                  <TH>Máx.</TH>
                  <TH>Mín.</TH>
                  <TH>Estado</TH>
                  <TH className="w-0">
                    <span className="sr-only">Acciones</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {variants.map((variant) => (
                  <TR key={variant.id}>
                    <TD className="font-medium">
                      {variant.sku}
                      {variant.isSerialized && <Badge tone="neutral" className="ml-2">serie</Badge>}
                      {variant.isLotTracked && <Badge tone="neutral" className="ml-2">lote</Badge>}
                    </TD>
                    <TD className="text-slate-500">{variant.unit}</TD>
                    <TD className="text-slate-500">{formatPrice(variant.basePrice)}</TD>
                    <TD className="text-slate-500">{formatPrice(variant.maxPrice)}</TD>
                    <TD className="text-slate-500">{formatPrice(variant.minPrice)}</TD>
                    <TD>
                      <Badge tone={statusTone(variant.status)}>
                        {VARIANT_STATUS_LABELS[variant.status as VariantStatus] ?? variant.status}
                      </Badge>
                    </TD>
                    <TD>
                      <Link
                        href={`/products/${product.id}/variants/${variant.id}`}
                        className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                      >
                        {canManage ? 'Editar' : 'Ver'}
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
}
