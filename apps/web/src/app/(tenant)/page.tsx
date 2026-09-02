import { redirect } from 'next/navigation';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardBody } from '../../components/ui/card';
import { getSession } from '../../lib/auth/session';

export const metadata = { title: 'Home · SaaS Inventory' };

/**
 * The operational home — **FRAME ONLY (F17-01 §5 / §17)**. This establishes the route, the title,
 * the responsive layout and the three zones the home is organised into; **no business data is
 * fetched or shown**. The zones are wired to real reads in **F17-12 (Home tiles)**, once the
 * modules they summarise exist and the tenant-timezone handling is in place (F17-02, GAP-HOME-DATE-TZ).
 *
 * The only request here is the session gate itself (`getSession()`), whose fields (name, tenant)
 * are session data, not business data.
 */

/** A single placeholder slot — visibly a development placeholder, never a simulated metric
 * (F17-01 §28). */
function PlaceholderTile({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-300">—</p>
      <p className="mt-1 text-xs text-slate-400">Wired in F17-12</p>
    </div>
  );
}

export default async function HomePage(): Promise<React.JSX.Element> {
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

      <section aria-labelledby="home-overview" className="flex flex-col gap-3">
        <h2 id="home-overview" className="text-sm font-semibold text-slate-900">
          Overview
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PlaceholderTile label="Orders today" />
          <PlaceholderTile label="Pending approvals" />
          <PlaceholderTile label="Returns to process" />
          <PlaceholderTile label="Transfers to receive" />
        </div>
      </section>

      <section aria-labelledby="home-attention" className="flex flex-col gap-3">
        <h2 id="home-attention" className="text-sm font-semibold text-slate-900">
          Needs attention
        </h2>
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">
              Operational queues — price approvals, returns, transfers, imports — appear here as
              their modules are built. Nothing is connected yet.
            </p>
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="home-actions" className="flex flex-col gap-3">
        <h2 id="home-actions" className="text-sm font-semibold text-slate-900">
          Quick actions
        </h2>
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">
              Shortcuts to create a sale, receive stock, start a transfer or run an import will
              appear here as those screens ship.
            </p>
          </CardBody>
        </Card>
      </section>
    </PageContainer>
  );
}
