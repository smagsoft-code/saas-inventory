import type { ReactNode } from 'react';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { serverApiFetch } from '../../../lib/api/server';
import { getTenantSettings } from '../../../lib/tenant/tenant-settings';
import type { Tenant } from '../../../lib/types/core';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardBody } from '../../../components/ui/card';
import { Badge, statusTone } from '../../../components/ui/badge';
import { TenantSettingsForm } from './tenant-settings-form';
import { RegionalSettingsForm } from './regional-settings-form';
import { BusinessHoursForm } from './business-hours-form';
import { TransferWorkflowForm } from './transfer-workflow-form';

export const metadata = { title: 'Configuración · SaaS Inventory' };

/**
 * Tenant administration (F17-02 / `S-SETTINGS`): the company record + the tenant's operational
 * configuration, for the **caller's own tenant only** — `tenantId` is never in the URL or a form
 * field, it is resolved by the backend from the verified session (multi-tenancy.md).
 *
 * Read-only info is shown to every authenticated tenant user; each edit form is gated on the real
 * backend permission and the API stays the authority — a hidden form only spares a request the
 * backend would refuse anyway (CLAUDE.md §7.6).
 *
 *  - `GET /tenant` (no permission) · `PATCH /tenant` (`core.tenant.update`) — company name.
 *  - `GET /administration/tenant-settings` (`administration.settings.view`) ·
 *    `PATCH /administration/tenant-settings` (`administration.settings.manage`) — timezone,
 *    business hours.
 */
function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

export default async function TenantSettingsPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  const canEditCompany = checker.can('core.tenant.update');
  const canViewSettings = checker.can('administration.settings.view');
  const canManageSettings = checker.can('administration.settings.manage');

  // Only request the settings endpoint when the caller may read it — otherwise it is a guaranteed
  // 403. `getTenantSettings()` still returns `null` defensively for any 401/403.
  const [tenant, settings] = await Promise.all([
    serverApiFetch<Tenant>('/api/v1/tenant'),
    canViewSettings ? getTenantSettings() : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Configuración"
        help="Configuración de esta empresa. Estos ajustes aplican solo a tu espacio de trabajo."
      />

      <SettingsSection title="Empresa">
        <dl className="grid max-w-md grid-cols-[9rem_1fr] gap-y-2 text-sm">
          <dt className="text-slate-500">Espacio de trabajo</dt>
          <dd className="text-slate-900">{tenant.slug}</dd>
          <dt className="text-slate-500">Estado</dt>
          <dd>
            <Badge tone={statusTone(tenant.status)}>{tenant.status}</Badge>
          </dd>
          {tenant.isDemo && (
            <>
              <dt className="text-slate-500">Tipo</dt>
              <dd>
                <Badge tone="warning">Demo</Badge>
              </dd>
            </>
          )}
          <dt className="text-slate-500">Creado</dt>
          <dd className="text-slate-900">{new Date(tenant.createdAt).toLocaleDateString('es')}</dd>
        </dl>
        {canEditCompany ? (
          <TenantSettingsForm tenant={tenant} />
        ) : (
          <p className="max-w-md text-sm text-slate-500">
            Nombre de la empresa: <span className="text-slate-900">{tenant.name}</span> — no
            tienes permiso para cambiarlo.
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        title="Regional"
        description="La zona horaria en la que se interpretan las fechas operativas de esta empresa. Pantallas posteriores la usan para decidir qué cuenta como «hoy» o «este mes»."
      >
        {canViewSettings ? (
          <RegionalSettingsForm
            timezone={settings?.timezone ?? 'UTC'}
            usingDefaults={settings === null || settings.updatedAt === null}
            canManage={canManageSettings}
          />
        ) : (
          <p className="max-w-md text-sm text-slate-500">
            No tienes permiso para ver la configuración regional.
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        title="Horario comercial"
        description="Opcional. Si se deja vacío, no se configura ningún horario — el sistema aún no lo hace cumplir en ninguna parte."
      >
        {canViewSettings ? (
          <BusinessHoursForm
            businessHours={settings?.businessHours ?? []}
            canManage={canManageSettings}
          />
        ) : (
          <p className="max-w-md text-sm text-slate-500">
            No tienes permiso para ver el horario comercial.
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        title="Flujo de transferencias"
        description="Qué etapas de una transferencia entre almacenes requieren una confirmación manual. No todas las empresas tienen personal para cada etapa — desactiva las que no apliquen a tu operación."
      >
        {canViewSettings ? (
          <TransferWorkflowForm
            requireApproval={settings?.transfersRequireApproval ?? true}
            requirePreparation={settings?.transfersRequirePreparation ?? true}
            usingDefaults={settings === null || settings.updatedAt === null}
            canManage={canManageSettings}
          />
        ) : (
          <p className="max-w-md text-sm text-slate-500">
            No tienes permiso para ver el flujo de transferencias.
          </p>
        )}
      </SettingsSection>
    </PageContainer>
  );
}
