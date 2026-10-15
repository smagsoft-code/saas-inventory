import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../../../lib/auth/permissions';
import { isApiError } from '../../../../../../lib/api/errors';
import { serverApiFetch } from '../../../../../../lib/api/server';
import {
  getProduct,
  getProductVariant,
  listProductImages,
} from '../../../../../../lib/catalog/products';
import { listAttributeDefinitions } from '../../../../../../lib/catalog/attributes';
import { loadCategoryAttributeFieldSets } from '../../../../../../lib/catalog/product-attributes';
import { listBalances } from '../../../../../../lib/inventory/balances';
import { buildLocationIndex } from '../../../../../../lib/inventory/location-index';
import { listQrCodes } from '../../../../../../lib/catalog/qr-codes';
import { apiPublicUrl } from '../../../../../../lib/api/public-url';
import { VARIANT_STATUS_LABELS, type VariantStatus } from '../../../../../../lib/types/products';
import { PageContainer } from '../../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../../../components/ui/card';
import { Badge, statusTone } from '../../../../../../components/ui/badge';
import { NoAccess } from '../../../../../../components/ui/no-access';
import { Table, TBody, TD, TH, THead, TR } from '../../../../../../components/ui/table';
import { VariantForm } from '../../variant-form';
import { ProductImageQrPanel } from '../../../product-image-qr-panel';
import { StagedImageProvider } from '../../../staged-image';

export const metadata = { title: 'Variante · SaaS Inventory' };

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
        <PageHeader title="Variante" />
        <NoAccess message="Necesitas el permiso de productos para ver esta página." />
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
  // Same permission the products table and the standalone /qr module already require to see or
  // generate a code (OUI-008) — never a new one invented for this card.
  const canManageQr = checker.can('catalog.qr.manage');

  const definitions =
    canManage && checker.can('categories.view') ? await listAttributeDefinitions() : [];
  const [fieldSets, balances, locationIndex, images, qrCodes] = await Promise.all([
    canManage && checker.can('categories.view')
      ? loadCategoryAttributeFieldSets(
          (path) => serverApiFetch(path),
          product.categoryId,
          definitions,
        )
      : Promise.resolve({ product: [], variant: [], options: {} }),
    canViewInventory
      ? listBalances({ productVariantId: variantId, pageSize: 100 }).catch(() => null)
      : Promise.resolve(null),
    canViewInventory ? buildLocationIndex(checker.can('warehouses.view')) : Promise.resolve(null),
    listProductImages(id).catch(() => []),
    canManageQr
      ? listQrCodes({ targetType: 'product_variant', targetId: variantId, pageSize: 1 }).catch(
          () => null,
        )
      : Promise.resolve(null),
  ]);

  const attrEntries = Object.entries(variant.attributes ?? {});
  // `null` (not 0) when it couldn't be determined at all — the "no se puede desactivar" guard
  // (`VariantForm`) treats those very differently: a real 0 clears it to deactivate; "unknown"
  // never blocks the change, it just says so (no `inventory.view`, or the fetch failed).
  const totalPhysicalStock = canViewInventory && balances ? balances.data.reduce((sum, b) => sum + b.quantityPhysical, 0) : null;
  const firstImageUrl = images[0]?.url;
  const existingQrCode = qrCodes?.data[0]?.code;
  const qrValue = existingQrCode ? `${apiPublicUrl()}/q/${existingQrCode}` : undefined;

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
      {/* Same row layout as `product-form.tsx`'s create flow — the form on the left, the image +
          QR `<aside>` on the right at the same position/size, not a separate full-width card
          below (OUI-009). */}
      <StagedImageProvider>
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <Card className="w-full max-w-xl">
          <CardBody className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-900">Detalles</h2>
            {canManage ? (
              <VariantForm
                mode="edit"
                productId={id}
                variant={variant}
                variantFields={fieldSets.variant}
                optionsByDefinitionId={fieldSets.options}
                canViewFloor={checker.can('pricing.floor.view')}
                canViewCost={checker.can('pricing.cost.view')}
                totalPhysicalStock={totalPhysicalStock}
              />
            ) : (
              <dl className="grid max-w-md grid-cols-[10rem_1fr] gap-y-2 text-sm">
                <dt className="text-slate-500">Código</dt>
                <dd className="text-slate-900">{variant.sku}</dd>
                <dt className="text-slate-500">Código de barras</dt>
                <dd className="text-slate-900">{variant.barcode ?? '—'}</dd>
                <dt className="text-slate-500">Unidad</dt>
                <dd className="text-slate-900">{variant.unit}</dd>
                <dt className="text-slate-500">Precio base</dt>
                <dd className="text-slate-900">{variant.basePrice.toFixed(2)}</dd>
                <dt className="text-slate-500">Precio máximo</dt>
                <dd className="text-slate-900">{variant.maxPrice.toFixed(2)}</dd>
                {typeof variant.minPrice === 'number' && (
                  <>
                    <dt className="text-slate-500">Precio mínimo</dt>
                    <dd className="text-slate-900">{variant.minPrice.toFixed(2)}</dd>
                  </>
                )}
                {typeof variant.cost === 'number' && (
                  <>
                    <dt className="text-slate-500">Costo</dt>
                    <dd className="text-slate-900">{variant.cost.toFixed(2)}</dd>
                  </>
                )}
                <dt className="text-slate-500">Serializado</dt>
                <dd className="text-slate-900">{variant.isSerialized ? 'Sí' : 'No'}</dd>
                <dt className="text-slate-500">Con seguimiento de lote</dt>
                <dd className="text-slate-900">{variant.isLotTracked ? 'Sí' : 'No'}</dd>
                {attrEntries.length > 0 && (
                  <>
                    <dt className="text-slate-500">Atributos</dt>
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

        <ProductImageQrPanel
          productId={id}
          variantId={variantId}
          apiPublicUrl={apiPublicUrl()}
          canManageImage={canManage}
          canManageQr={canManageQr}
          maxPrice={variant.maxPrice}
          {...(firstImageUrl ? { initialImageUrl: firstImageUrl } : {})}
          {...(qrValue ? { initialQrValue: qrValue } : {})}
        />
      </div>
      </StagedImageProvider>

      {canViewInventory && (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Existencias</h2>
              <div className="flex items-center gap-3">
                <Link
                  href={`/inventory/movements?productVariantId=${variant.id}`}
                  className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                >
                  Movimientos
                </Link>
                {canAdjustInventory && (
                  <Link
                    href={`/inventory/adjust?productVariantId=${variant.id}&sku=${encodeURIComponent(variant.sku)}`}
                    className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                  >
                    Ajustar
                  </Link>
                )}
              </div>
            </div>
            {!balances || balances.data.length === 0 ? (
              <p className="text-sm text-slate-500">
                Aún no hay existencias registradas para esta variante.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Almacén</TH>
                    <TH>Sucursal</TH>
                    <TH className="text-right">Disponible</TH>
                    <TH className="text-right">Físico</TH>
                    <TH className="text-right">Reservado</TH>
                    <TH className="text-right">Comprometido</TH>
                  </TR>
                </THead>
                <TBody>
                  {balances.data.map((balance) => (
                    <TR key={balance.id}>
                      <TD className="text-slate-700">
                        <Link
                          href={`/inventory/${balance.id}`}
                          className="underline underline-offset-2"
                        >
                          {locationIndex?.locationName(balance.locationId) ?? balance.locationId}
                        </Link>
                      </TD>
                      <TD className="text-slate-500">
                        {locationIndex?.warehouseName(balance.locationId) ?? '—'}
                      </TD>
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
