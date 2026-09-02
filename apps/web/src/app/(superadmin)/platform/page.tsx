import { redirect } from 'next/navigation';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardBody } from '../../../components/ui/card';
import { getPlatformSession } from '../../../lib/auth/platform-session';

export const metadata = { title: 'Platform · SaaS Inventory' };

/**
 * Platform-admin home — **FRAME ONLY (F17-01 §5 / §17)**. No data is wired: company management
 * (`S-SA-TENANTS`, list / view / suspend / activate) is **F17-13**. This page establishes the
 * platform context, the shell, and a placeholder for what F17-13 will fill.
 *
 * A platform admin is not a tenant user — nothing here reads tenant-scoped data
 * (multi-tenancy.md#superadmin-vs-tenant).
 */
export default async function PlatformHomePage(): Promise<React.JSX.Element> {
  const admin = await getPlatformSession();
  if (!admin) {
    redirect('/platform/login');
  }

  return (
    <PageContainer>
      <PageHeader
        title="Platform administration"
        description={`Signed in as ${admin.fullName}.`}
      />
      <Card>
        <CardBody>
          <p className="text-sm font-medium text-slate-900">Companies</p>
          <p className="mt-1 text-sm text-slate-500">
            Placeholder — the company list, and the suspend / activate actions, are built in a
            later phase (F17-13). This area intentionally shows no tenant data.
          </p>
        </CardBody>
      </Card>
    </PageContainer>
  );
}
