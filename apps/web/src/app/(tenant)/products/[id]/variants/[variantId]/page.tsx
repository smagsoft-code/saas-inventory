import { notFound } from 'next/navigation';
import { getSession } from '../../../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../../../lib/auth/permissions';
import { isApiError } from '../../../../../../lib/api/errors';
import { serverApiFetch } from '../../../../../../lib/api/server';
import { getProduct, getProductVariant } from '../../../../../../lib/catalog/products';
import { listAttributeDefinitions } from '../../../../../../lib/catalog/attributes';
import { loadCategoryAttributeFieldSets } from '../../../../../../lib/catalog/product-attributes';
import { VARIANT_STATUS_LABELS, type VariantStatus } from '../../../../../../lib/types/products';
import { PageContainer } from '../../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../../../components/ui/card';
import { Badge, statusTone } from '../../../../../../components/ui/badge';
import { NoAccess } from '../../../../../../components/ui/no-access';
import { VariantForm } from '../../variant-form';

export const metadata = { title: 'Variant · SaaS Inventory' };

export default async function VariantDetailPage({
  params,
}: {
  params: Promise<{ id: string; variantId: string }>;
}): Promise<React.JSX.Element> {
  const { id, variantId } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('products.view')) {
    return (
      <PageContainer>
        <PageHeader title="Variant" />
        <NoAccess message="You need the products permission to view this page." />
      </PageContainer>
    );
  }
  const canManage = checker.can('products.manage');

  let product;
  let variant;
  try {
    [product, variant] = await Promise.all([getProduct(id), getProductVariant(id, variantId)]);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const definitions = canManage && checker.can('categories.view') ? await listAttributeDefinitions() : [];
  const fieldSets =
    canManage && checker.can('categories.view')
      ? await loadCategoryAttributeFieldSets((path) => serverApiFetch(path), product.categoryId, definitions)
      : { product: [], variant: [], options: {} };

  const attrEntries = Object.entries(variant.attributes ?? {});

  return (
    <PageContainer>
      <PageHeader
        title={variant.sku}
        description={product.name}
        actions={
          <Badge tone={statusTone(variant.status)}>
            {VARIANT_STATUS_LABELS[variant.status as VariantStatus] ?? variant.status}
          </Badge>
        }
      />
      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Details</h2>
          {canManage ? (
            <VariantForm
              mode="edit"
              productId={id}
              variant={variant}
              variantFields={fieldSets.variant}
              optionsByDefinitionId={fieldSets.options}
              canViewFloor={checker.can('pricing.floor.view')}
              canViewCost={checker.can('pricing.cost.view')}
            />
          ) : (
            <dl className="grid max-w-md grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">SKU</dt>
              <dd className="text-slate-900">{variant.sku}</dd>
              <dt className="text-slate-500">Barcode</dt>
              <dd className="text-slate-900">{variant.barcode ?? '—'}</dd>
              <dt className="text-slate-500">Unit</dt>
              <dd className="text-slate-900">{variant.unit}</dd>
              <dt className="text-slate-500">Base price</dt>
              <dd className="text-slate-900">{variant.basePrice.toFixed(2)}</dd>
              <dt className="text-slate-500">Max price</dt>
              <dd className="text-slate-900">{variant.maxPrice.toFixed(2)}</dd>
              {typeof variant.minPrice === 'number' && (
                <>
                  <dt className="text-slate-500">Min price</dt>
                  <dd className="text-slate-900">{variant.minPrice.toFixed(2)}</dd>
                </>
              )}
              {typeof variant.cost === 'number' && (
                <>
                  <dt className="text-slate-500">Cost</dt>
                  <dd className="text-slate-900">{variant.cost.toFixed(2)}</dd>
                </>
              )}
              <dt className="text-slate-500">Serialized</dt>
              <dd className="text-slate-900">{variant.isSerialized ? 'Yes' : 'No'}</dd>
              <dt className="text-slate-500">Lot tracked</dt>
              <dd className="text-slate-900">{variant.isLotTracked ? 'Yes' : 'No'}</dd>
              {attrEntries.length > 0 && (
                <>
                  <dt className="text-slate-500">Attributes</dt>
                  <dd className="text-slate-900">
                    <ul className="flex flex-col gap-0.5">
                      {attrEntries.map(([key, value]) => (
                        <li key={key}>
                          <span className="text-slate-500">{key}:</span>{' '}
                          {Array.isArray(value) ? value.join(', ') : String(value)}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </>
              )}
            </dl>
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
}
