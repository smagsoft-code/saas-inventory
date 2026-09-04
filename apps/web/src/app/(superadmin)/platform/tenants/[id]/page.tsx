import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageContainer } from '../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../../components/ui/card';
import { Badge } from '../../../../../components/ui/badge';
import { isApiError } from '../../../../../lib/api/errors';
import { getPlatformSession } from '../../../../../lib/auth/platform-session';
import { getPlatformTenant } from '../../../../../lib/platform/tenants';
import {
  TENANT_STATUS_LABELS,
  tenantStatusTone,
  tenantLifecycleAction,
} from '../../../../../lib/types/platform-tenant';
import { TenantLifecycleActions } from './tenant-lifecycle-actions';

export const metadata = { title: 'Company · Platform' };

/**
 * `S-SA-TENANT-DETAIL` (F17-13) — `GET /api/v1/platform/tenants/:tenantId` (`@PlatformOnly()`).
 * Shows exactly the six fields the DTO carries; nothing is derived or inferred, and no
 * tenant-scoped data is read (isolation — `f17-super-admin.md` §4). The only actions are
 * suspend / activate (the only platform-side mutations that exist); there is no edit or delete
 * endpoint, so those are not offered.
 */
export default async function PlatformTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const admin = await getPlatformSession();
  if (!admin) {
    redirect('/platform/login');
  }

  const { id } = await params;

  let tenant;
  try {
    tenant = await getPlatformTenant(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const action = tenantLifecycleAction(tenant.status);
  const fields: { label: string; value: React.ReactNode }[] = [
    { label: 'Name', value: tenant.name },
    { label: 'Slug', value: <code className="text-xs">{tenant.slug}</code> },
    {
      label: 'Status',
      value: (
        <Badge tone={tenantStatusTone(tenant.status)}>
          {TENANT_STATUS_LABELS[tenant.status] ?? tenant.status}
        </Badge>
      ),
    },
    { label: 'Type', value: tenant.isDemo ? 'Demo company' : 'Real company' },
    { label: 'Company ID', value: <code className="text-xs">{tenant.id}</code> },
    { label: 'Created', value: new Date(tenant.createdAt).toLocaleString() },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={tenant.name}
        description={tenant.slug}
        actions={
          <Link
            href="/platform/tenants"
            className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
          >
            ← All companies
          </Link>
        }
      />

      <Card>
        <CardBody>
          <h2 className="text-sm font-semibold text-slate-900">Details</h2>
          <dl className="mt-4 grid max-w-lg grid-cols-[9rem_1fr] gap-y-3 text-sm">
            {fields.map((field) => (
              <div key={field.label} className="contents">
                <dt className="text-slate-500">{field.label}</dt>
                <dd className="text-slate-900">{field.value}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Lifecycle</h2>
          {action ? (
            <TenantLifecycleActions tenantId={tenant.id} tenantName={tenant.name} action={action} />
          ) : (
            <p className="text-sm text-slate-500">
              This company is <span className="font-medium">{tenant.status}</span>. There is no
              platform action for this state.
            </p>
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
}
