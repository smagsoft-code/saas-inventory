import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { serverApiFetch } from '../../../lib/api/server';
import type { PaginatedUsers } from '../../../lib/types/core';

// OUI-001: no hay un tipo cerrado para `status` (es `string` en el DTO) — se traduce el rótulo
// visible sin tocar el valor que viaja a la API.
const USER_STATUS_LABELS: Record<string, string> = { invited: 'Invitado', active: 'Activo', disabled: 'Deshabilitado' };
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Badge, statusTone } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { ButtonLink } from '../../../components/ui/button';
import { UsersFilters } from './users-filters';

/** Listing is gated by `core.users.read` server-side. A direct visit without it gets the API's
 * 403, surfaced by the route error boundary — the API is the authority, not this page.
 *
 * `q` (name search, closing `GAP-USER-FILTERS`'s name-search half) is resolved entirely by the
 * backend (`GET /users?q=`, `ILIKE '%q%'` on `fullName`) — never a client-side filter over an
 * already-paged slice, since `GET /users` is paginated. */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;

  const [session, page] = await Promise.all([
    getSession(),
    serverApiFetch<PaginatedUsers>('/api/v1/users', { query: { page: 1, pageSize: 50, ...(q ? { q } : {}) } }),
  ]);
  const canCreate = createPermissionChecker(session?.permissions ?? []).can('core.users.create');
  const hasFilter = Boolean(q);

  return (
    <PageContainer>
      <PageHeader
        title="Usuarios"
        help="Personas con acceso a este espacio de trabajo."
        actions={
          canCreate ? (
            <ButtonLink href="/users/new" size="sm">
              Nuevo usuario
            </ButtonLink>
          ) : null
        }
      />

      <UsersFilters initial={{ q }} />

      {page.data.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'Ningún usuario coincide con tu búsqueda' : 'Aún no hay usuarios'}
          description={
            hasFilter
              ? 'Prueba con otro nombre.'
              : 'Invita a un colega para darle acceso a este espacio de trabajo.'
          }
          action={
            hasFilter ? (
              <Link href="/users" className="text-sm font-medium text-slate-900 underline">
                Quitar búsqueda
              </Link>
            ) : canCreate ? (
              <Link href="/users/new" className="text-sm font-medium text-slate-900 underline">
                Crear el primer usuario
              </Link>
            ) : null
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Usuario</th>
                  <th className="px-4 py-3 font-medium">Rol</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.data.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/users/${row.id}`}
                        className="font-medium text-slate-900 underline"
                      >
                        {row.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.email}</td>
                    <td className="px-4 py-3 text-slate-600">{row.roleNames.join(', ') || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(row.status)}>{USER_STATUS_LABELS[row.status] ?? row.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/users/${row.id}`}
                        aria-label={`Editar ${row.fullName}`}
                        title="Editar"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.5}
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.862 4.487a2.06 2.06 0 0 1 2.915 2.914L8.5 18.678l-4 1 1-4Z"
                          />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageContainer>
  );
}
