import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { getImportJob } from '../../../../lib/imports/imports';
import {
  DUPLICATE_HANDLING_MODE_LABELS,
  IMPORT_JOB_STATUS_LABELS,
  importJobStatusTone,
  type DuplicateHandlingMode,
  type ImportJobStatus,
} from '../../../../lib/types/imports';
import { shortId } from '../../../../lib/inventory/location-index';
import { getLocation } from '../../../../lib/inventory/locations';
import { getWarehouse } from '../../../../lib/inventory/warehouses';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { NoAccess } from '../../../../components/ui/no-access';
import { ImportPipeline } from './import-pipeline';
import { ImportRows } from './import-rows';

export const metadata = { title: 'Importación · SaaS Inventory' };

/**
 * Import detail (`S-IMP-DETAIL` / `S-IMP-ROWS`) — `GET /api/v1/imports/:id` (`import.execute`). The
 * centre of the staged pipeline: the mapping / validate / review / confirm / cancel actions live in
 * `ImportPipeline`, driven off `import_jobs.status`; the staged rows are `ImportRows`. The backend
 * re-checks the transition + permission on every call — a 403/409 is shown in place, never a
 * redirect. There is no progress percentage in the contract (`GAP-IMPORT-PROGRESS`) — only the
 * status and the counters below.
 */
export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('import.execute')) {
    return (
      <PageContainer>
        <PageHeader title="Importación" />
        <NoAccess message="Necesitas el permiso de importación para ver esta página." />
      </PageContainer>
    );
  }

  let job;
  try {
    job = await getImportJob(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const mappedColumns = Object.entries(job.columnMapping);

  // Default Sucursal · Almacén as names, not ids. Needs locations.view / warehouses.view — without
  // them (or if the lookup fails) the short id is shown instead, never an error.
  let defaultLocationLabel: string | null = null;
  if (job.defaultLocationId) {
    try {
      const location = checker.can('locations.view') ? await getLocation(job.defaultLocationId) : null;
      if (location) {
        const warehouse = checker.can('warehouses.view')
          ? await getWarehouse(location.warehouseId).catch(() => null)
          : null;
        defaultLocationLabel = warehouse ? `${warehouse.name} · ${location.name}` : location.name;
      }
    } catch {
      defaultLocationLabel = null;
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Importación"
        description={job.originalFilename}
        actions={
          <Badge tone={importJobStatusTone(job.status)}>
            {IMPORT_JOB_STATUS_LABELS[job.status as ImportJobStatus] ?? job.status}
          </Badge>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <dl className="grid max-w-xl grid-cols-[12rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Archivo</dt>
            <dd className="break-all text-slate-900">{job.originalFilename}</dd>
            <dt className="text-slate-500">Manejo de duplicados</dt>
            <dd className="text-slate-900">
              {DUPLICATE_HANDLING_MODE_LABELS[job.duplicateHandlingMode as DuplicateHandlingMode] ??
                job.duplicateHandlingMode}
            </dd>
            {job.defaultLocationId && (
              <>
                <dt className="text-slate-500">Almacén predeterminado</dt>
                <dd className="text-slate-900">
                  {defaultLocationLabel ?? <code className="text-xs">{shortId(job.defaultLocationId)}</code>}
                </dd>
              </>
            )}
            <dt className="text-slate-500">Columnas mapeadas</dt>
            <dd className="text-slate-900">{mappedColumns.length === 0 ? 'Aún sin mapear' : mappedColumns.length}</dd>
            <dt className="text-slate-500">Creado</dt>
            <dd className="text-slate-900">{new Date(job.createdAt).toLocaleString('es')}</dd>
            {job.startedAt && (
              <>
                <dt className="text-slate-500">Iniciado</dt>
                <dd className="text-slate-900">{new Date(job.startedAt).toLocaleString('es')}</dd>
              </>
            )}
            {job.completedAt && (
              <>
                <dt className="text-slate-500">Completado</dt>
                <dd className="text-slate-900">{new Date(job.completedAt).toLocaleString('es')}</dd>
              </>
            )}
          </dl>

          {mappedColumns.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">Mapeo de columnas</summary>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {mappedColumns.map(([header, target]) => (
                  <li key={header} className="text-slate-600">
                    <span className="font-medium text-slate-900">{header}</span> → {target}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardBody>
      </Card>

      <ImportPipeline
        job={job}
        canUseInventoryMode={checker.can('import.inventory')}
      />

      <ImportRows jobId={job.id} columnMapping={job.columnMapping} />

      <Link href="/imports" className="text-sm font-medium text-slate-500 hover:underline">
        Volver a importaciones
      </Link>
    </PageContainer>
  );
}
