import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { serverApiFetch } from '../../../lib/api/server';
import type { Tenant } from '../../../lib/types/core';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardBody } from '../../../components/ui/card';
import { Badge, statusTone } from '../../../components/ui/badge';
import { TenantSettingsForm } from './tenant-settings-form';

/** Every authenticated tenant user can view the company's basic info; only a caller with
 * `core.tenant.update` sees the edit form. The API is the authority — this only hides a form the
 * request would be refused anyway (CLAUDE.md §7.6). */
export default async function TenantSettingsPage(): Promise<React.JSX.Element> {
  const [session, tenant] = await Promise.all([
    getSession(),
    serverApiFetch<Tenant>('/api/v1/tenant'),
  ]);
  const canEdit = createPermissionChecker(session?.permissions ?? []).can('core.tenant.update');

  return (
    <PageContainer>
      <PageHeader title="Company settings" description="Your workspace details." />
      <Card>
        <CardBody className="flex flex-col gap-4">
          <dl className="grid max-w-sm grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Workspace</dt>
            <dd className="text-slate-900">{tenant.slug}</dd>
            <dt className="text-slate-500">Status</dt>
            <dd>
              <Badge tone={statusTone(tenant.status)}>{tenant.status}</Badge>
            </dd>
          </dl>
          {canEdit ? (
            <TenantSettingsForm tenant={tenant} />
          ) : (
            <p className="text-sm text-slate-500">
              You don&apos;t have permission to edit company settings.
            </p>
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
}
