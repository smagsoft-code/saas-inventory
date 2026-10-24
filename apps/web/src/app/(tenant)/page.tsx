import { redirect } from 'next/navigation';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { getSession } from '../../lib/auth/session';
import { createPermissionChecker } from '../../lib/auth/permissions';
import { loadHomeDashboard } from '../../lib/home/dashboard';
import { HomeHighlights, HomeKpiGrid, HomeTopProducts } from './home-dashboard';
import { HomeLocationFilter } from './home-location-filter';
import { HomeMobile } from './home-mobile';
import { SalesTrendChart } from './sales-trend-chart';

export const metadata = { title: 'Inicio · SaaS Inventory' };

/**
 * The operational Home (`S-HOME`). Two rows of real report cards — Total productos, Alertas de
 * stock, Valor total, Ventas del mes, Costo neto del mes (KPI row) and Ventas de hoy / del mes / del
 * año (highlight row) — plus the top-10 of products sold today. Every number is a real endpoint's
 * response, permission-gated, with honest per-card degradation. The Almacén filter sits in the
 * header level with the welcome message (right-aligned) and only offers the locations the user is
 * authorized for. Server Component: one `Promise.all` fan-out of independent reads, no client
 * fetching, no polling.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string; year?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const sp = await searchParams;
  const checker = createPermissionChecker(session.permissions);
  const dashboard = await loadHomeDashboard(
    checker,
    session.timezone,
    sp.locationId || undefined,
    new Date(),
    /^\d{4}$/.test(sp.year ?? '') ? Number(sp.year) : undefined,
  );

  const visibleTiles = dashboard.tiles.filter((tile) => tile.state !== 'no-access');
  const visibleHighlights = dashboard.highlights.filter((h) => h.state !== 'no-access');

  const chartYear = /^d{4}$/.test(sp.year ?? '') ? sp.year : undefined;

  return (
    <>
      {/* Phones get the dedicated layout; tablets and desktops keep the card grid below. */}
      <div className="md:hidden">
        <HomeMobile fullName={session.fullName} dashboard={dashboard} chartYear={chartYear} />
      </div>
      <div className="hidden md:block">
    <PageContainer>
      <PageHeader
        title={`Bienvenido, ${session.fullName}`}
        description={`Esto es lo que necesita atención en ${session.tenantSlug}.`}
        actions={
          dashboard.locationOptions.length > 0 ? (
            <HomeLocationFilter
              options={dashboard.locationOptions}
              {...(dashboard.selectedLocationId ? { selectedLocationId: dashboard.selectedLocationId } : {})}
              {...(/^\d{4}$/.test(sp.year ?? '') ? { chartYear: sp.year! } : {})}
            />
          ) : undefined
        }
      />

      <section aria-labelledby="home-overview" className="flex flex-col gap-4">
        <h2 id="home-overview" className="sr-only">
          Resumen
        </h2>
        <HomeKpiGrid tiles={visibleTiles} />
        <HomeHighlights highlights={visibleHighlights} />
      </section>

      {dashboard.trend.state !== 'no-access' && <SalesTrendChart trend={dashboard.trend} locationId={dashboard.selectedLocationId} />}

      {dashboard.topProducts.state !== 'no-access' && (
        <section aria-labelledby="home-top-products" className="flex flex-col gap-3">
          <h2 id="home-top-products" className="text-sm font-semibold text-slate-900">
            Top 10 productos vendidos hoy
          </h2>
          <HomeTopProducts card={dashboard.topProducts} />
        </section>
      )}
    </PageContainer>
      </div>
    </>
  );
}
