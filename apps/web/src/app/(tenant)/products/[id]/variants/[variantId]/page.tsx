import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../../../lib/auth/permissions';
import { isApiError } from '../../../../../../lib/api/errors';
import { serverApiFetch } from '../../../../../../lib/api/server';
import { getProduct, getProductVariant } from '../../../../../../lib/catalog/products';
import { listAttributeDefinitions } from '../../../../../../lib/catalog/attributes';
import { loadCategoryAttributeFieldSets } from '../../../../../../lib/catalog/product-attributes';
import { listBalances } from '../../../../../../lib/inventory/balances';
import { buildLocationIndex } from '../../../../../../lib/inventory/location-index';
import { VARIANT_STATUS_LABELS, type VariantStatus } from '../../../../../../lib/types/products';
import { PageContainer } from '../../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../../../components/ui/card';
import { Badge, statusTone } from '../../../../../../components/ui/badge';
import { NoAccess } from '../../../../../../components/ui/no-access';
import { Table, TBody, TD, TH, THead, TR } from '../../../../../../components/ui/table';
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

  const canViewInventory = checker.can('inventory.view');
  const canAdjustInventory = checker.can('inventory.adjust');

  const definitions = canManage && checker.can('categories.view') ? await listAttributeDefinitions() : [];
  const [fieldSets, balances, locationIndex] = await Promise.all([
    canManage && checker.can('categories.view')
      ? loadCategoryAttributeFieldSets((path) => serverApiFetch(path), product.categoryId, definitions)
      : Promise.resolve({ product: [], variant: [], options: {} }),
    canViewInventory ? listBalances({ productVariantId: variantId, pageSize: 100 }).catch(() => null) : Promise.resolve(null),
    canViewInventory ? buildLocationIndex(checker.can('warehouses.view')) : Promise.resolve(null),
  ]);

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

      {canViewInventory && (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Stock</h2>
              <div className="flex items-center gap-3">
                <Link
                  href={`/inventory/movements?productVariantId=${variant.id}`}
                  className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                >
                  Movements
                </Link>
                {canAdjustInventory && (
                  <Link
                    href={`/inventory/adjust?productVariantId=${variant.id}`}
                    className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                  >
                    Adjust
                  </Link>
                )}
              </div>
            </div>
            {!balances || balances.data.length === 0 ? (
              <p className="text-sm text-slate-500">No stock recorded for this variant yet.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Location</TH>
                    <TH>Warehouse</TH>
                    <TH className="text-right">Available</TH>
                    <TH className="text-right">Physical</TH>
                    <TH className="text-right">Reserved</TH>
                    <TH className="text-right">Committed</TH>
                  </TR>
                </THead>
                <TBody>
                  {balances.data.map((balance) => (
                    <TR key={balance.id}>
                      <TD className="text-slate-700">
                        <Link href={`/inventory/${balance.id}`} className="underline underline-offset-2">
                          {locationIndex?.locationName(balance.locationId) ?? balance.locationId}
                        </Link>
                      </TD>
                      <TD className="text-slate-500">{locationIndex?.warehouseName(balance.locationId) ?? '—'}</TD>
                      <TD className="text-right font-medium">{balance.quantityAvailable}</TD>
                      <TD className="text-right text-slate-500">{balance.quantityPhysical}</TD>
                      <TD className="text-right text-slate-500">{balance.quantityReserved}</TD>
                      <TD className="text-right text-slate-500">{balance.quantityCommitted}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}
    </PageContainer>
  );
}
