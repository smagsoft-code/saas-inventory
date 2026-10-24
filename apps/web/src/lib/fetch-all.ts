import type { Paginated } from './types/pagination';

/** Largest list the "Ver todos" view renders on screen. Bigger sets are cut here (and say so);
 * the Excel/PDF export has its own, larger cap on the backend. */
export const VIEW_ALL_CAP = 1000;
const PAGE_SIZE = 100; // the list endpoints' own maximum pageSize

export interface AllRows<T> {
  data: T[];
  /** Rows matching the filters in total (may exceed `data.length` when `truncated`). */
  total: number;
  truncated: boolean;
}

/**
 * "Ver todos": walks a paginated list endpoint (100 rows per request, the endpoints' own maximum)
 * until every row — up to `VIEW_ALL_CAP` — has been read. The first page tells us the total; the
 * remaining pages are fetched in parallel. Same endpoint, same filters, same scope as the paged
 * view, so nothing about authorization differs.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<Paginated<T>>,
  cap: number = VIEW_ALL_CAP,
): Promise<AllRows<T>> {
  const first = await fetchPage(1, PAGE_SIZE);
  const total = first.meta.total;
  const wanted = Math.min(total, cap);
  const pages = Math.ceil(wanted / PAGE_SIZE);
  const rest = pages > 1 ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchPage(i + 2, PAGE_SIZE))) : [];
  const data = [first, ...rest].flatMap((p) => p.data).slice(0, cap);
  return { data, total, truncated: total > data.length };
}
