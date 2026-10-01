import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageContainer } from '../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../../components/ui/card';
import { Badge } from '../../../../../components/ui/badge';
import { isApiError } from '../../../../../lib/api/errors';
import { getPlatformSession } from '../../../../../lib/auth/platform-session';
import { getAdminInvitationStatus, getCurrentSupportSession, getPlatformTenant } from '../../../../../lib/platform/tenants';
import {
  TENANT_STATUS_LABELS,
  tenantStatusTone,
  tenantLifecycleAction,
} from '../../../../../lib/types/platform-tenant';
import { AdminInvitationPanel } from './admin-invitation-panel';
import { StartSupportSessionForm } from './start-support-session-form';
import { TenantLifecycleActions } from './tenant-lifecycle-actions';

export const metadata = { title: 'Empresa · Plataforma' };

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

  const [invitation, currentSession] = await Promise.all([
    getAdminInvitationStatus(id),
    getCurrentSupportSession().catch(() => null),
  ]);

  const action = tenantLifecycleAction(tenant.status);
  const fields: { label: string; value: React.ReactNode }[] = [
    { label: 'Nombre', value: tenant.name },
    { label: 'Slug', value: <code className="text-xs">{tenant.slug}</code> },
    {
      label: 'Estado',
      value: (
        <Badge tone={tenantStatusTone(tenant.status)}>
          {TENANT_STATUS_LABELS[tenant.status] ?? tenant.status}
        </Badge>
      ),
    },
    { label: 'Tipo', value: tenant.isDemo ? 'Empresa demo' : 'Empresa real' },
    { label: 'ID de empresa', value: <code className="text-xs">{tenant.id}</code> },
    { label: 'Creada', value: new Date(tenant.createdAt).toLocaleString('es') },
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
            ← Todas las empresas
          </Link>
        }
      />

      <Card>
        <CardBody>
          <h2 className="text-sm font-semibold text-slate-900">Detalles</h2>
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
          <h2 className="text-sm font-semibold text-slate-900">Ciclo de vida</h2>
          {action ? (
            <TenantLifecycleActions tenantId={tenant.id} tenantName={tenant.name} action={action} />
          ) : (
            <p className="text-sm text-slate-500">
              Esta empresa está <span className="font-medium">{TENANT_STATUS_LABELS[tenant.status] ?? tenant.status}</span>. No
              hay ninguna acción de plataforma para este estado.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Administrador del Tenant</h2>
          <AdminInvitationPanel tenantId={tenant.id} invitation={invitation} />
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Soporte</h2>
          <p className="text-sm text-slate-500">
            Accede temporalmente a esta empresa como administrador de plataforma, en un contexto
            auditado y limitado a esta empresa. No se usa ni se conoce la contraseña del
            administrador del Tenant.
          </p>
          <StartSupportSessionForm
            tenantId={tenant.id}
            existingSession={currentSession && currentSession.tenantId === tenant.id ? currentSession : null}
          />
        </CardBody>
      </Card>
    </PageContainer>
  );
}
