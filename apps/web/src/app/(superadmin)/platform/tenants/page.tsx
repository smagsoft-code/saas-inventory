import { redirect } from 'next/navigation';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { EmptyState } from '../../../../components/ui/empty-state';
import { getPlatformSession } from '../../../../lib/auth/platform-session';
import { listPlatformTenants } from '../../../../lib/platform/tenants';
import { PlatformTenantsTable } from './platform-tenants-table';

export const metadata = { title: 'Companies · Platform' };

/**
 * `S-SA-TENANTS` — the SuperAdmin company list (F17-13). `GET /api/v1/platform/tenants`
 * (`@PlatformOnly()`) returns the **whole `tenants` array, unpaginated**, with the six fields the
 * DTO exposes and nothing tenant-scoped (isolation — `f17-super-admin.md` §4). No server
 * filter/sort/search params exist, so the (small) array is filtered/sorted client-side.
 *
 * Read-only: the only mutations that exist platform-side are suspend/activate, which live on the
 * detail page. There is no create-company endpoint (`GAP-SA-CREATE-TENANT`) → no "New company"
 * action anywhere.
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
        title="Companies"
        description="Every company on the platform. Suspend or activate one from its detail page."
      />

      {tenants.length === 0 ? (
        <EmptyState
          title="No companies yet"
          description="Companies appear here after they sign up. Platform-side provisioning is not available."
        />
      ) : (
        <PlatformTenantsTable tenants={tenants} />
      )}
    </PageContainer>
  );
}
