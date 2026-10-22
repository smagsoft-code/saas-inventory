import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ButtonLink } from '../../../../components/ui/button';
import { getPlatformSession } from '../../../../lib/auth/platform-session';
import { listPlatformTenants } from '../../../../lib/platform/tenants';
import { PlatformTenantsTable } from './platform-tenants-table';

export const metadata = { title: 'Empresas · Plataforma' };

/**
 * `S-SA-TENANTS` — the SuperAdmin company list (F17-13). `GET /api/v1/platform/tenants`
 * (`@PlatformOnly()`) returns the **whole `tenants` array, unpaginated**, with the six fields the
 * DTO exposes and nothing tenant-scoped (isolation — `f17-super-admin.md` §4). No server
 * filter/sort/search params exist, so the (small) array is filtered/sorted client-side.
 *
 * The only mutations that exist platform-side beyond creation are suspend/activate, which live on
 * the detail page. Creation (ADR-0036, closes `GAP-SA-CREATE-TENANT`) is `POST /platform/tenants`
 * at `/platform/tenants/new` — no password field, an invitation is issued instead.
 */
export default async function PlatformTenantsPage(): Promise<React.JSX.Element> {
  const admin = await getPlatformSession();
  if (!admin) {
    redirect('/platform/login');
  }

  // A genuine failure here propagates to (superadmin)/error.tsx — the shared ErrorState, never a
  // raw stack. A 401 has already been handled by the layout's getPlatformSession() gate.
  const tenants = await listPlatformTenants();

  return (
    <PageContainer>
      <PageHeader
        title="Empresas"
        help="Todas las empresas de la plataforma. Suspende o activa una, o accede como soporte, desde su página de detalle."
        actions={
          <ButtonLink href="/platform/tenants/new" size="sm">
            Crear empresa
          </ButtonLink>
        }
      />

      {tenants.length === 0 ? (
        <EmptyState
          title="Aún no hay empresas"
          description="Crea la primera empresa, o espera a que alguien se registre por su cuenta."
          action={
            <Link href="/platform/tenants/new" className="text-sm font-medium text-slate-900 underline">
              Crear la primera empresa
            </Link>
          }
        />
      ) : (
        <PlatformTenantsTable tenants={tenants} />
      )}
    </PageContainer>
  );
}
