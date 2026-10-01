import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageContainer } from '../../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../../../components/ui/card';
import { Badge, statusTone } from '../../../../../../components/ui/badge';
import { NoAccess } from '../../../../../../components/ui/no-access';
import { EmptyState } from '../../../../../../components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '../../../../../../components/ui/table';
import { isApiError } from '../../../../../../lib/api/errors';
import { getPlatformSession } from '../../../../../../lib/auth/platform-session';
import { getCurrentSupportSession, getPlatformTenant } from '../../../../../../lib/platform/tenants';
import { listSupportUsers, listSupportWarehouses } from '../../../../../../lib/platform/support';
import { WarehouseStatusToggle } from './warehouse-status-toggle';

export const metadata = { title: 'Panel de soporte · Plataforma' };

/**
 * ADR-0036 §9 — the SUPPORT_READ/SUPPORT_WRITE panel. Requires an `active` `platform_support_sessions`
 * row for THIS `:id`, owned by the signed-in platform admin — `SupportSessionGuard` is the real
 * authority (every request below is independently re-checked server-side); this page's own session
 * lookup only decides what to render before those calls are even made, so a stale/expired session
 * shows a clear "start one" message instead of two raw 403s.
 *
 * The curated read surface (`GAP-SUPPORT-READ-SCOPE`) is users + warehouses only — nothing else is
 * offered here, by design; the one write action is the warehouse status toggle.
 */
export default async function PlatformTenantSupportPage({
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

  const session = await getCurrentSupportSession().catch(() => null);
  const sessionForTenant = session && session.tenantId === tenant.id ? session : null;

  if (!sessionForTenant || sessionForTenant.status !== 'active') {
    return (
      <PageContainer>
        <PageHeader title={`Soporte · ${tenant.name}`} />
        <NoAccess
          message={
            sessionForTenant
              ? 'La sesión de soporte ha expirado.'
              : 'No tienes una sesión de soporte activa para esta empresa.'
          }
        />
        <Link href={`/platform/tenants/${tenant.id}`} className="text-sm font-medium text-slate-900 underline">
          Volver a la ficha de la empresa e iniciar una sesión de soporte
        </Link>
      </PageContainer>
    );
  }

  const writable = sessionForTenant.mode === 'write';

  const [users, warehouses] = await Promise.all([
    listSupportUsers(tenant.id),
    listSupportWarehouses(tenant.id),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title={`Soporte · ${tenant.name}`}
        description={`Sesión ${writable ? 'de intervención' : 'de solo lectura'} — motivo: "${sessionForTenant.reason}".`}
        actions={
          <Link href={`/platform/tenants/${tenant.id}`} className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline">
            ← Ficha de la empresa
          </Link>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Usuarios</h2>
          {users.length === 0 ? (
            <EmptyState title="Sin usuarios" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Nombre</TH>
                  <TH>Correo</TH>
                  <TH>Rol</TH>
                  <TH>Estado</TH>
                </TR>
              </THead>
              <TBody>
                {users.map((user) => (
                  <TR key={user.id}>
                    <TD>{user.fullName}</TD>
                    <TD className="text-slate-500">{user.email}</TD>
                    <TD className="text-slate-500">{user.roleNames.join(', ') || '—'}</TD>
                    <TD>
                      <Badge tone={statusTone(user.status)}>{user.status}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Almacenes</h2>
          {warehouses.length === 0 ? (
            <EmptyState title="Sin almacenes" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Nombre</TH>
                  <TH>Código</TH>
                  <TH>Estado</TH>
                  <TH className="w-0">
                    <span className="sr-only">Acciones</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {warehouses.map((warehouse) => (
                  <TR key={warehouse.id}>
                    <TD>{warehouse.name}</TD>
                    <TD className="text-slate-500">{warehouse.code}</TD>
                    <TD>
                      <Badge tone={statusTone(warehouse.status)}>{warehouse.status}</Badge>
                    </TD>
                    <TD>
                      <WarehouseStatusToggle
                        tenantId={tenant.id}
                        warehouseId={warehouse.id}
                        status={warehouse.status}
                        writable={writable}
                      />
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
