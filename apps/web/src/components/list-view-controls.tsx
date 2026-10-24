import Link from 'next/link';
import { buttonClasses } from './ui/button';
import { ExportLinks } from './export-icons';

/**
 * The strip above a list that can be exported: "Ver todos" (renders every row on screen instead of
 * one page; "Ver paginado" goes back) followed by the Excel/PDF icons. The icons always export the
 * whole filtered set, whichever view is on screen — "Ver todos" only changes what is *shown*.
 * Server-renderable: both toggles are plain links that change one query param.
 */
export function ListViewControls({
  showingAll,
  allHref,
  pagedHref,
  shown,
  total,
  truncated = false,
  canToggle = true,
  excelHref,
  pdfHref,
}: {
  showingAll: boolean;
  allHref: string;
  pagedHref: string;
  /** Rows currently rendered (the whole list when `showingAll`). */
  shown: number;
  /** Rows matching the filters across all pages. */
  total: number;
  /** "Ver todos" hit the on-screen cap — say so instead of implying the list is complete. */
  truncated?: boolean;
  /** Hide the toggle when there is nothing more to show (a single page). */
  canToggle?: boolean;
  excelHref: string;
  pdfHref: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-slate-500" role="status">
        {showingAll
          ? truncated
            ? `Mostrando los primeros ${shown} de ${total}. Acota los filtros para ver el resto en pantalla; la exportación incluye hasta 2000 filas.`
            : `Mostrando todos: ${total}.`
          : ''}
      </p>
      <div className="flex items-center gap-2">
        {(canToggle || showingAll) && (
          <Link href={showingAll ? pagedHref : allHref} className={buttonClasses('secondary', 'sm')}>
            {showingAll ? 'Ver paginado' : 'Ver todos'}
          </Link>
        )}
        <ExportLinks excelHref={excelHref} pdfHref={pdfHref} />
      </div>
    </div>
  );
}
