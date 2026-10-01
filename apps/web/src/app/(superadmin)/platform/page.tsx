import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardBody } from '../../../components/ui/card';
import { getPlatformSession } from '../../../lib/auth/platform-session';
import { httpErrorMessage } from '../../../lib/api/errors';
import { getPlatformSummary } from '../../../lib/platform/summary';
import type { PlatformSummary } from '../../../lib/types/platform-summary';
import { PlatformSummaryError, PlatformSummarySection } from './platform-summary-section';

export const metadata = { title: 'Plataforma · SaaS Inventory' };

/** First instant of the current UTC month, and now — the `[from, to)` window for the "new
 * companies" count. Computed in **UTC**: a platform metric spans every tenant, so there is no
 * single tenant timezone to anchor "this month" to (F18-01's timezone semantics are tenant-scoped).
 * The tile label says "(UTC)" so the boundary is honest. */
function currentUtcMonthWindow(now = new Date()): { from: string; to: string; label: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const label = `desde ${from.toLocaleDateString('en-CA', { timeZone: 'UTC' })} (UTC)`;
  return { from: from.toISOString(), to: now.toISOString(), label };
}

/**
 * Platform-admin home. F18-10 adds the "minimal, supported" platform metrics row (dashboards.md
 * §4) — company count / status / demo / new-this-month, every tile a `COUNT(*)` over the `tenants`
 * table alone (`GET /platform/summary`, `@PlatformOnly()`). Real per-tenant usage / activity /
 * billing is still `GAP-PLATFORM-AGGREGATE` / `GAP-SA-BILLING` (each needs an ADR + new
 * architecture).
 *
 * A platform admin is not a tenant user — nothing here reads tenant-scoped data
 * (multi-tenancy.md#superadmin-vs-tenant).
 */
export default async function PlatformHomePage(): Promise<React.JSX.Element> {
  const admin = await getPlatformSession();
  if (!admin) {
    redirect('/platform/login');
  }

  const window = currentUtcMonthWindow();
  let summary: PlatformSummary | undefined;
  let summaryError: string | undefined;
  try {
    summary = await getPlatformSummary({ from: window.from, to: window.to });
  } catch (error) {
    summaryError = httpErrorMessage(error);
  }

  return (
    <PageContainer>
      <PageHeader
        title="Administración de la plataforma"
        description={`Sesión iniciada como ${admin.fullName}.`}
      />

      {summary ? (
        <PlatformSummarySection summary={summary} newWindowLabel={window.label} />
      ) : (
        summaryError && <PlatformSummaryError message={summaryError} />
      )}

      <Card>
        <CardBody className="flex flex-col gap-2">
          <p className="text-sm font-medium text-slate-900">Empresas</p>
          <p className="text-sm text-slate-500">
            Lista todas las empresas de la plataforma, y suspende o activa una.
          </p>
          <div className="mt-2">
            <Link
              href="/platform/tenants"
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              Administrar empresas
            </Link>
          </div>
        </CardBody>
      </Card>
      <p className="text-xs text-slate-400">
        Las métricas de uso, actividad y facturación por empresa aún no están disponibles.
      </p>
    </PageContainer>
  );
}
