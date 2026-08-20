import { getCurrentUser } from '../../../../lib/current-user';
import type { Role } from '../../../../lib/core-types';
import { serverApiFetch } from '../../../../lib/server-fetch';
import { CreateUserForm } from './create-user-form';

export default async function NewUserPage(): Promise<React.JSX.Element> {
  const user = await getCurrentUser();
  const canAssignRole = user?.permissions.includes('core.roles.assign') ?? false;
  const roles = canAssignRole ? await serverApiFetch<Role[]>('/api/v1/roles') : [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-slate-900">New user</h1>
      <CreateUserForm roles={roles} />
    </div>
  );
}
