import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listPendingQrVariants } from '../../../../lib/catalog/qr-codes';
import { listCategories } from '../../../../lib/catalog/categories';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { BulkQrGenerator } from './bulk-qr-generator';

export const metadata = { title: 'Generación masiva de códigos QR · SaaS Inventory' };

/**
 * `S-QR-BULK` — generación masiva. Same permission as every other QR management route
 * (`catalog.qr.manage`, §25 — no new `qr.bulk` permission). The initial, unfiltered candidate list
 * (`GET /qr-codes/pending-variants`) is fetched server-side like every other list page in this app;
 * `BulkQrGenerator` (Client Component) re-fetches itself only when the search box changes, and owns
 * selection/confirmation/generation entirely — the same client/server split `qr-form.tsx` already
 * uses for its own product→variant picker.
 */
export default async function BulkQrPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('catalog.qr.manage')) {
    return (
      <PageContainer>
        <PageHeader title="Generación masiva de códigos QR" />
        <NoAccess message="Necesitas el permiso de gestión de QR para hacer esto." />
      </PageContainer>
    );
  }

  const [initial, categories] = await Promise.all([
    listPendingQrVariants(),
    checker.can('categories.view') ? listCategories({ pageSize: 100 }).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Generación masiva de códigos QR"
        help="Genera códigos para varias variantes de producto a la vez. Solo se muestran variantes que todavía no tienen un código QR vigente; filtra por categoría para encontrarlas más rápido."
      />
      <BulkQrGenerator
        initialVariants={initial.data}
        initialTotal={initial.meta.total}
        categories={(categories?.data ?? []).filter((c) => c.status === 'active').map((c) => ({ id: c.id, name: c.name }))}
      />
    </PageContainer>
  );
}
