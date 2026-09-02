/** The paginated envelope every offset-paginated list endpoint returns
 * (`@saas-inventory/types` `PaginatedResult` / `apps/api` `PaginatedResult<T>`). Mirrored locally,
 * the same convention as `lib/types/core.ts`. */
export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export const DEFAULT_PAGE_SIZE = 20;
