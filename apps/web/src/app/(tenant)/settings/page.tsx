import { getCurrentUser } from '../../../lib/current-user';
import type { Tenant } from '../../../lib/core-types';
import { serverApiFetch } from '../../../lib/server-fetch';
import { TenantSettingsForm } from './tenant-settings-form';

/** §7/§8 — every authenticated tenant user can view the tenant's basic info; only a caller with
 * core.tenant.update can edit it (the API is the actual authority — this only hides the form the
 * request would fail against anyway, per CLAUDE.md §7.6). */
export default async function TenantSettingsPage(): Promise<React.JSX.Element> {
  const [user, tenant] = await Promise.all([getCurrentUser(), serverApiFetch<Tenant>('/api/v1/tenant')]);
  const canEdit = user?.permissions.includes('core.tenant.update') ?? false;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-slate-900">Company settings</h1>
      <dl className="grid max-w-sm grid-cols-2 gap-y-2 text-sm">
        <dt className="text-slate-500">Workspace</dt>
        <dd className="text-slate-900">{tenant.slug}</dd>
        <dt className="text-slate-500">Status</dt>
        <dd className="text-slate-900">{tenant.status}</dd>
      </dl>
      {canEdit ? (
        <TenantSettingsForm tenant={tenant} />
      ) : (
        <p className="text-sm text-slate-500">You don&apos;t have permission to edit company settings.</p>
      )}
    </div>
  );
}
