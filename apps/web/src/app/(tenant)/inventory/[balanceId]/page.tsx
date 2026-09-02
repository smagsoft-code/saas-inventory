import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { getBalance } from '../../../../lib/inventory/balances';
import { buildLocationIndex, shortId } from '../../../../lib/inventory/location-index';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { NoAccess } from '../../../../components/ui/no-access';

export const metadata = { title: 'Stock detail · SaaS Inventory' };

export default async function BalanceDetailPage({
  params,
}: {
  params: Promise<{ balanceId: string }>;
}): Promise<React.JSX.Element> {
  const { balanceId } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.view')) {
    return (
      <PageContainer>
        <PageHeader title="Stock detail" />
        <NoAccess message="You need the inventory permission to view this page." />
      </PageContainer>
    );
  }
  const canAdjust = checker.can('inventory.adjust');

  let balance;
  try {
    balance = await getBalance(balanceId);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const index = await buildLocationIndex(checker.can('warehouses.view'));
  const kardexHref = `/inventory/movements?productVariantId=${balance.productVariantId}&locationId=${balance.locationId}`;

  const quantities = [
    { label: 'Available', value: balance.quantityAvailable, hint: 'Physical − reserved − committed (computed by the database).' },
    { label: 'Physical', value: balance.quantityPhysical },
    { label: 'Reserved', value: balance.quantityReserved },
    { label: 'Committed', value: balance.quantityCommitted },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Stock detail"
        description={`${index.locationName(balance.locationId)} · variant ${shortId(balance.productVariantId)}`}
        actions={
          canAdjust ? (
            <Link
              href={`/inventory/adjust?productVariantId=${balance.productVariantId}&locationId=${balance.locationId}`}
              className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
            >
              Adjust stock
            </Link>
          ) : undefined
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {quantities.map((q) => (
              <div key={q.label} className="rounded-md border border-slate-200 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{q.label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{q.value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Available = physical − reserved − committed, computed by the database.
          </p>

          <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Location</dt>
            <dd className="text-slate-900">{index.locationName(balance.locationId)}</dd>
            <dt className="text-slate-500">Warehouse</dt>
            <dd className="text-slate-900">{index.warehouseName(balance.locationId)}</dd>
            <dt className="text-slate-500">Variant</dt>
            <dd className="text-slate-900">
              <code className="text-xs">{balance.productVariantId}</code>
            </dd>
            <dt className="text-slate-500">Version</dt>
            <dd className="text-slate-900">{balance.version}</dd>
            <dt className="text-slate-500">Updated</dt>
            <dd className="text-slate-900">{new Date(balance.updatedAt).toLocaleString()}</dd>
          </dl>

          <Link href={kardexHref} className="text-sm font-medium text-slate-700 underline underline-offset-2">
            View movement history for this variant &amp; location
          </Link>
        </CardBody>
      </Card>
    </PageContainer>
  );
}
