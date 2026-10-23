import { redirect } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listCategories } from '../../../../lib/catalog/categories';
import { listWarehouses } from '../../../../lib/inventory/warehouses';
import { listLocations } from '../../../../lib/inventory/locations';
import { listPendingQrVariants, listQrCodes } from '../../../../lib/catalog/qr-codes';
import { apiPublicUrl } from '../../../../lib/api/public-url';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { ButtonLink } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { NoAccess } from '../../../../components/ui/no-access';
import { QrForm } from './qr-form';

export const metadata = { title: 'Generar código QR · SaaS Inventory' };

/**
 * `S-QR-NEW` — `POST /api/v1/qr-codes` (`catalog.qr.manage`). A product variant is picked as
 * Categoría → Producto → Variante, where the products offered are the ones `GET /qr-codes/pending-variants`
 * returns (variants with no active QR yet); a Location is the alternative target (`GET /locations`).
 * Selector sources are bounded fetches, the same pattern F17-06/07/08 use.
 *
 * `?productId=&variantId=` (from `/products`' own "Generar" link on a row without a QR yet)
 * pre-select the target in `QrForm` instead of leaving the caller to re-pick a product they
 * already had on screen.
 */
export default async function NewQrCodePage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; variantId?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const checker = createPermissionChecker(session.permissions);
  if (!checker.can('catalog.qr.manage')) {
    return (
      <PageContainer>
        <PageHeader title="Generar código QR" />
        <NoAccess message="Necesitas el permiso de gestión de QR para hacer esto." />
      </PageContainer>
    );
  }

  // The picker sources ride on their own permissions (`categories.view` / `locations.view`); a QR
  // manager without one just sees an empty picker rather than a page error. The pending list needs
  // only `catalog.qr.manage`, already checked above.
  const [pending, categories, warehouses, locations, activeVariantQrs, activeLocationQrs] = await Promise.all([
    listPendingQrVariants().catch(() => null),
    checker.can('categories.view')
      ? listCategories({ pageSize: 100 }).catch(() => null)
      : Promise.resolve(null),
    checker.can('warehouses.view')
      ? listWarehouses({ status: 'active', pageSize: 100 }).catch(() => null)
      : Promise.resolve(null),
    checker.can('locations.view')
      ? listLocations({ status: 'active', pageSize: 100 }).catch(() => null)
      : Promise.resolve(null),
    // Bounded to the first 100 (same convention as everywhere else) — lets the picker mark a
    // target that already has an active QR *before* the caller tries to submit, rather than only
    // reacting to the backend's 409 after the fact.
    listQrCodes({ targetType: 'product_variant', pageSize: 100 }).catch(() => null),
    listQrCodes({ targetType: 'location', pageSize: 100 }).catch(() => null),
  ]);
  const sp = await searchParams;

  const variantIdsWithActiveQr = new Set(
    (activeVariantQrs?.data ?? []).filter((qr) => qr.status === 'active').map((qr) => qr.targetId),
  );
  const locationIdsWithActiveQr = new Set(
    (activeLocationQrs?.data ?? []).filter((qr) => qr.status === 'active').map((qr) => qr.targetId),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Generar código QR"
        help="Vincula una etiqueta impresa a una variante o a un almacén. Solo se ofrecen productos que todavía no tienen código QR."
        actions={
          <ButtonLink href="/qr/bulk" variant="secondary">
            Generar QR masivo
          </ButtonLink>
        }
      />
      <Card>
        <CardBody>
          <QrForm
            categories={(categories?.data ?? []).filter((c) => c.status === 'active').map((c) => ({ id: c.id, name: c.name }))}
            initialPending={pending?.data ?? []}
            initialPendingTotal={pending?.meta.total ?? 0}
            warehouses={(warehouses?.data ?? []).map((w) => ({ id: w.id, name: w.name }))}
            locations={(locations?.data ?? []).map((l) => ({ id: l.id, warehouseId: l.warehouseId, name: l.name }))}
            variantIdsWithActiveQr={variantIdsWithActiveQr}
            locationIdsWithActiveQr={locationIdsWithActiveQr}
            {...(sp.productId ? { initialProductId: sp.productId } : {})}
            {...(sp.variantId ? { initialVariantId: sp.variantId } : {})}
            publicUrl={apiPublicUrl()}
          />
        </CardBody>
      </Card>
    </PageContainer>
  );
}
