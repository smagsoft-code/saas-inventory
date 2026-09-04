import { redirect } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listProducts } from '../../../../lib/catalog/products';
import { listLocations } from '../../../../lib/inventory/locations';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { NoAccess } from '../../../../components/ui/no-access';
import { QrForm } from './qr-form';

export const metadata = { title: 'Generate QR code · SaaS Inventory' };

/**
 * `S-QR-NEW` — `POST /api/v1/qr-codes` (`catalog.qr.manage`). Target is picked as Product → Variant
 * (`GET /products/:id/variants`, no tenant-wide variant list — `GAP-VARIANT-LIST`) or Location
 * (`GET /locations`). Both selector sources are bounded fetches, the same pattern F17-06/07/08 use.
 */
export default async function NewQrCodePage(): Promise<React.JSX.Element> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const checker = createPermissionChecker(session.permissions);
  if (!checker.can('catalog.qr.manage')) {
    return (
      <PageContainer>
        <PageHeader title="Generate QR code" />
        <NoAccess message="You need the QR management permission to do this." />
      </PageContainer>
    );
  }

  // The picker sources ride on their own permissions (`products.view` / `locations.view`); a QR
  // manager without one just sees an empty picker for that target type rather than a page error.
  const [products, locations] = await Promise.all([
    checker.can('products.view')
      ? listProducts({ status: 'active', pageSize: 100 }).catch(() => null)
      : Promise.resolve(null),
    checker.can('locations.view')
      ? listLocations({ status: 'active', pageSize: 100 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader title="Generate QR code" description="Link a printed label to a variant or a location." />
      <Card>
        <CardBody>
          <QrForm
            products={(products?.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
            locations={(locations?.data ?? []).map((l) => ({ id: l.id, name: l.name }))}
          />
        </CardBody>
      </Card>
    </PageContainer>
  );
}
