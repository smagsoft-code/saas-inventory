import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardBody } from '../../../components/ui/card';
import { getPlatformSession } from '../../../lib/auth/platform-session';

export const metadata = { title: 'Platform · SaaS Inventory' };

/**
 * Platform-admin home. The only platform capability that exists is company lifecycle management
 * (`S-SA-TENANTS` / `S-SA-TENANT-DETAIL`, F17-13) — a platform dashboard with real metrics is
 * `GAP-PLATFORM-AGGREGATE` (future), so this page is a plain entry point, not an analytics screen.
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
        <CardBody className="flex flex-col gap-2">
          <p className="text-sm font-medium text-slate-900">Companies</p>
          <p className="text-sm text-slate-500">
            List every company on the platform, and suspend or activate one.
          </p>
          <div className="mt-2">
            <Link
              href="/platform/tenants"
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              Manage companies
            </Link>
          </div>
        </CardBody>
      </Card>
      <p className="text-xs text-slate-400">
        Platform metrics, company provisioning and platform-admin management are not available yet.
      </p>
    </PageContainer>
  );
}
