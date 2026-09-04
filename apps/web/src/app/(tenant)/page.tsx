import { redirect } from 'next/navigation';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { getSession } from '../../lib/auth/session';
import { createPermissionChecker } from '../../lib/auth/permissions';
import { HOME_QUICK_ACTIONS, loadHomeDashboard } from '../../lib/home/dashboard';
import { HomeAttention, HomeKpiGrid, HomeQuickActions } from './home-dashboard';

export const metadata = { title: 'Home · SaaS Inventory' };

/**
 * The operational Home (`S-HOME`) — **F17-12**. Replaces the F17-01 frame with real reads: every
 * KPI is a real list endpoint's `meta.total` (`f17-traceability-matrix.md`), permission-gated, with
 * honest per-tile degradation. No invented endpoint, no faked metric, no revenue/low-stock number
 * (deferred / `GAP-INV-AGGREGATE` — see `f17-gaps.md`). Server Component: one `Promise.all` fan-out
 * of independent reads, no client fetching, no polling.
 */
export default async function HomePage(): Promise<React.JSX.Element> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const checker = createPermissionChecker(session.permissions);
  const dashboard = await loadHomeDashboard(checker, session.timezone);

  const visibleTiles = dashboard.tiles.filter((tile) => tile.state !== 'no-access');
  const quickActions = HOME_QUICK_ACTIONS.filter((action) => checker.can(action.permission));

  return (
    <PageContainer>
      <PageHeader
        title={`Welcome, ${session.fullName}`}
        description={`Here's what needs attention in ${session.tenantSlug}.`}
      />

      <section aria-labelledby="home-overview" className="flex flex-col gap-3">
        <h2 id="home-overview" className="text-sm font-semibold text-slate-900">
          Overview
        </h2>
        <HomeKpiGrid tiles={visibleTiles} />
      </section>

      <section aria-labelledby="home-attention" className="flex flex-col gap-3">
        <h2 id="home-attention" className="text-sm font-semibold text-slate-900">
          Needs attention
        </h2>
        <HomeAttention tiles={visibleTiles} />
      </section>

      {quickActions.length > 0 && (
        <section aria-labelledby="home-actions" className="flex flex-col gap-3">
          <h2 id="home-actions" className="text-sm font-semibold text-slate-900">
            Quick actions
          </h2>
          <HomeQuickActions actions={quickActions} />
        </section>
      )}
    </PageContainer>
  );
}
