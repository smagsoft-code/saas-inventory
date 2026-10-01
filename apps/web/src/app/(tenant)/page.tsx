import { redirect } from 'next/navigation';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { getSession } from '../../lib/auth/session';
import { createPermissionChecker } from '../../lib/auth/permissions';
import { loadHomeDashboard } from '../../lib/home/dashboard';
import { HomeKpiGrid, HomeTopProducts } from './home-dashboard';
import { HomeLocationFilter } from './home-location-filter';

export const metadata = { title: 'Inicio · SaaS Inventory' };

/**
 * The operational Home (`S-HOME`) — OUI-002 redesign. Five real report cards, no chart: ventas
 * del día, productos disponibles, valor total de inventario, transferencias en tránsito y el
 * top-10 de productos vendidos hoy — every number a real report endpoint's response, permission-
 * gated, with honest per-tile degradation. An Almacén filter at the top narrows every card at
 * once (`lib/home/dashboard.ts` documents exactly how, per card). Server Component: one
 * `Promise.all` fan-out of independent reads, no client fetching, no polling.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const sp = await searchParams;
  const checker = createPermissionChecker(session.permissions);
  const dashboard = await loadHomeDashboard(checker, session.timezone, sp.locationId || undefined);

  const visibleTiles = dashboard.tiles.filter((tile) => tile.state !== 'no-access');

  return (
    <PageContainer>
      <PageHeader
        title={`Bienvenido, ${session.fullName}`}
        description={`Esto es lo que necesita atención en ${session.tenantSlug}.`}
      />

      {dashboard.locationOptions.length > 0 && (
        <HomeLocationFilter
          options={dashboard.locationOptions}
          {...(dashboard.selectedLocationId ? { selectedLocationId: dashboard.selectedLocationId } : {})}
        />
      )}

      <section aria-labelledby="home-overview" className="flex flex-col gap-3">
        <h2 id="home-overview" className="text-sm font-semibold text-slate-900">
          Resumen
        </h2>
        <HomeKpiGrid tiles={visibleTiles} />
      </section>

      {dashboard.topProducts.state !== 'no-access' && (
        <section aria-labelledby="home-top-products" className="flex flex-col gap-3">
          <h2 id="home-top-products" className="text-sm font-semibold text-slate-900">
            Top 10 productos vendidos hoy
          </h2>
          <HomeTopProducts card={dashboard.topProducts} />
        </section>
      )}
    </PageContainer>
  );
}
