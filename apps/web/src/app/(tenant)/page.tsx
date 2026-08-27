import { redirect } from 'next/navigation';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardBody } from '../../components/ui/card';
import { getSession } from '../../lib/auth/session';

/**
 * The authenticated landing page. No business modules exist yet (FASE 17) — this only
 * demonstrates the shell and centralised session access.
 */
export default async function DashboardPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <PageContainer>
      <PageHeader
        title={`Welcome, ${session.fullName}`}
        description={`Signed in to ${session.tenantSlug}.`}
      />
      <Card>
        <CardBody>
          <p className="text-sm text-slate-600">
            The application foundation is in place. Operational modules — catalog, inventory,
            purchasing, sales and reports — arrive in the next phase and will appear in the sidebar
            as they are built.
          </p>
        </CardBody>
      </Card>
    </PageContainer>
  );
}
