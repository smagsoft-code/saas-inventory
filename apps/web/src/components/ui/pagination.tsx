import Link from 'next/link';
import { cn } from '../../lib/cn';

/**
 * Offset pagination (F17-03 §19 — the real `PaginatedResult.meta` contract: `page`, `pageSize`,
 * `total`, `totalPages`). Renders "Showing X–Y of N" + prev/next as real links that only change
 * the `page` query param (`buildHref`), so it works in a Server Component list without client
 * state. Hidden entirely when there is a single page.
 */
export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  buildHref,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Given a 1-based page number, return the href for that page. */
  buildHref: (page: number) => string;
}): React.JSX.Element | null {
  if (total === 0 || totalPages <= 1) {
    return null;
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const linkClass = 'rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
  const disabledClass = 'rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-300';

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-slate-500">
        Showing <span className="font-medium text-slate-700">{from}</span>–
        <span className="font-medium text-slate-700">{to}</span> of{' '}
        <span className="font-medium text-slate-700">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link href={buildHref(page - 1)} className={linkClass} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={cn(disabledClass)} aria-disabled>
            Previous
          </span>
        )}
        <span className="text-sm text-slate-500">
          Page {page} of {totalPages}
        </span>
        {hasNext ? (
          <Link href={buildHref(page + 1)} className={linkClass} rel="next">
            Next
          </Link>
        ) : (
          <span className={cn(disabledClass)} aria-disabled>
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
